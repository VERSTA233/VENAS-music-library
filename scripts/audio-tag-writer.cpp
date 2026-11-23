/* TagLib 写入后端。仅对已复制的暂存文件调用；原文件提交由任务层管理。 */
#include <fstream>
#include <filesystem>
#include <iostream>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>
#include <taglib/commentsframe.h>
#include <taglib/id3v1tag.h>
#include <taglib/id3v2tag.h>
#include <taglib/infotag.h>
#include <taglib/mpegfile.h>
#include <taglib/mpegproperties.h>
#include <taglib/mp4file.h>
#include <taglib/mp4tag.h>
#include <taglib/mp4item.h>
#include <taglib/vorbisfile.h>
#include <taglib/xiphcomment.h>
#include <taglib/textidentificationframe.h>
#include <taglib/unsynchronizedlyricsframe.h>
#include <taglib/wavfile.h>
#include <taglib/wavproperties.h>
#ifdef _WIN32
#include <windows.h>
#include <shellapi.h>
#endif

using Values = std::map<std::string, std::string>;

static TagLib::String text(const std::string &value) {
  return TagLib::String(value, TagLib::String::UTF8);
}

static void setText(TagLib::ID3v2::Tag *tag, const char *id, const std::string &value) {
  tag->removeFrames(id);
  if (value.empty()) return;
  auto *frame = new TagLib::ID3v2::TextIdentificationFrame(id, TagLib::String::UTF8);
  frame->setText(text(value));
  tag->addFrame(frame);
}

static void setCustom(TagLib::ID3v2::Tag *tag, const std::string &key, const std::string &value) {
  const auto frames = tag->frameList("TXXX");
  for (auto *frame : frames) {
    auto *custom = dynamic_cast<TagLib::ID3v2::UserTextIdentificationFrame *>(frame);
    if (custom && custom->description().upper() == text(key).upper()) tag->removeFrame(frame);
  }
  tag->addFrame(new TagLib::ID3v2::UserTextIdentificationFrame(text(key), TagLib::StringList(text(value)), TagLib::String::UTF8));
}

static void applyValues(TagLib::ID3v2::Tag *tag, const Values &values) {
  const std::map<std::string, const char *> frames = {
    {"TITLE", "TIT2"}, {"ARTIST", "TPE1"}, {"ALBUM", "TALB"}, {"DATE", "TDRC"},
    {"TRACKNUMBER", "TRCK"}, {"GENRE", "TCON"}, {"MOOD", "TMOO"}, {"ALBUMARTIST", "TPE2"}, {"GROUPING", "GRP1"}
  };
  for (const auto &[key, value] : values) {
    const auto mapped = frames.find(key);
    if (mapped != frames.end()) setText(tag, mapped->second, value);
    else if (key == "LABEL" || key == "WORK" || key == "RELEASETYPE") setCustom(tag, key, value);
    else if (key == "LYRICS") {
      tag->removeFrames("USLT");
      auto *lyrics = new TagLib::ID3v2::UnsynchronizedLyricsFrame(TagLib::String::UTF8);
      lyrics->setLanguage("und");
      lyrics->setText(text(value));
      tag->addFrame(lyrics);
    }
    else if (key == "COMMENT") {
      tag->removeFrames("COMM");
      auto *comment = new TagLib::ID3v2::CommentsFrame(TagLib::String::UTF8);
      comment->setLanguage("und");
      comment->setText(text(value));
      tag->addFrame(comment);
    }
    else if (key != "DISCNUMBER" && key != "DISCTOTAL") throw std::runtime_error("Unsupported field: " + key);
  }
  if (values.count("DISCNUMBER") || values.count("DISCTOTAL")) {
    std::string existing;
    const auto positions = tag->frameList("TPOS");
    if (!positions.isEmpty()) existing = positions.front()->toString().to8Bit(true);
    const auto separator = existing.find('/');
    auto disc = existing.substr(0, separator);
    auto total = separator == std::string::npos ? std::string() : existing.substr(separator + 1);
    if (values.count("DISCNUMBER")) disc = values.at("DISCNUMBER");
    if (values.count("DISCTOTAL")) total = values.at("DISCTOTAL");
    setText(tag, "TPOS", total.empty() ? disc : disc + "/" + total);
  }
}

static void applyMp4Values(TagLib::MP4::Tag *tag, const Values &values) {
  const std::map<std::string, std::string> atoms = {
    {"TITLE", "©nam"}, {"ARTIST", "©ART"}, {"ALBUM", "©alb"}, {"DATE", "©day"},
    {"GENRE", "©gen"}, {"ALBUMARTIST", "aART"}, {"WORK", "©wrk"}, {"GROUPING", "©grp"}, {"LYRICS", "©lyr"}, {"COMMENT", "©cmt"},
    {"LABEL", "----:com.apple.iTunes:LABEL"}, {"MOOD", "----:com.apple.iTunes:MOOD"},
    {"RELEASETYPE", "----:com.apple.iTunes:RELEASETYPE"}
  };
  for (const auto &[key, value] : values) {
    const auto mapped = atoms.find(key);
    if (mapped != atoms.end()) {
      if (key == "GENRE") tag->removeItem("gnre");
      if (value.empty()) tag->removeItem(text(mapped->second));
      else tag->setItem(text(mapped->second), TagLib::MP4::Item(TagLib::StringList(text(value))));
    }
    else if (key != "TRACKNUMBER" && key != "DISCNUMBER" && key != "DISCTOTAL") throw std::runtime_error("Unsupported field: " + key);
  }
  auto number = [](const std::string &value) {
    size_t consumed = 0;
    const int n = std::stoi(value, &consumed);
    if (consumed != value.size() || n < 0 || n > 65535) throw std::runtime_error("Invalid MP4 track/disc number");
    return n;
  };
  if (values.count("TRACKNUMBER")) {
    const auto existing = tag->item("trkn").toIntPair();
    tag->setItem("trkn", TagLib::MP4::Item(number(values.at("TRACKNUMBER")), existing.second));
  }
  if (values.count("DISCNUMBER") || values.count("DISCTOTAL")) {
    const auto existing = tag->item("disk").toIntPair();
    tag->setItem("disk", TagLib::MP4::Item(values.count("DISCNUMBER") ? number(values.at("DISCNUMBER")) : existing.first,
      values.count("DISCTOTAL") ? number(values.at("DISCTOTAL")) : existing.second));
  }
}

// 不让 XiphComment 重新解析/序列化图片：原始图片字段、vendor 和未知字段逐字节保留。
static TagLib::ByteVector updateVorbisPacket(const TagLib::ByteVector &packet, const Values &values) {
  if (packet.size() < 16 || packet[0] != 3 || packet.mid(1, 6) != TagLib::ByteVector("vorbis", 6)) throw std::runtime_error("Invalid Vorbis comment packet");
  unsigned int position = 7;
  auto uint32 = [&]() {
    if (position > packet.size() || packet.size() - position < 4) throw std::runtime_error("Truncated Vorbis length");
    const auto n = packet.toUInt(position, false); position += 4; return n;
  };
  const auto vendorSize = uint32();
  if (vendorSize > packet.size() - position) throw std::runtime_error("Invalid Vorbis vendor");
  position += vendorSize;
  const auto prefix = packet.mid(0, position);
  const auto count = uint32();
  if (count > (packet.size() - position) / 4) throw std::runtime_error("Invalid Vorbis comment count");
  std::vector<TagLib::ByteVector> kept;
  for (unsigned int i = 0; i < count; i++) {
    const auto length = uint32();
    if (length > packet.size() - position) throw std::runtime_error("Truncated Vorbis comment");
    const auto entry = packet.mid(position, length); position += length;
    const std::string value(entry.data(), entry.size());
    const auto equals = value.find('=');
    if (equals == std::string::npos || equals == 0) throw std::runtime_error("Invalid Vorbis comment field");
    const auto key = text(value.substr(0, equals)).upper().to8Bit(true);
    if (!values.count(key)) kept.push_back(entry);
  }
  if (position >= packet.size() || packet[position] != 1) throw std::runtime_error("Invalid Vorbis framing bit");
  // 合法的注释包可在 framing bit 后有 padding，保留原始尾部。
  const auto tail = packet.mid(position);
  for (const auto &[key, value] : values) {
    if (value.empty()) continue;
    const auto entry = key + "=" + value;
    kept.emplace_back(entry.data(), entry.size());
  }
  auto result = prefix;
  result.append(TagLib::ByteVector::fromUInt(kept.size(), false));
  for (const auto &entry : kept) result.append(TagLib::ByteVector::fromUInt(entry.size(), false)).append(entry);
  result.append(tail);
  return result;
}

static int runWriter(int argc, char **argv) {
  try {
    if (argc == 2 && std::string(argv[1]) == "--version") { std::cout << "venas-tag-writer-1\n"; return 0; }
    if (argc < 3) throw std::runtime_error("Usage: writer <mp3|wav|ogg|m4a> <staged-copy> [FIELD VALUE]...");
    Values values;
    if (argc == 5 && std::string(argv[3]) == "--values-file") {
      // 长歌词通过长度前缀文件传入，避免命令行长度限制和 shell 转义。
      std::ifstream input(std::filesystem::u8path(argv[4]), std::ios::binary);
      auto readString = [&]() {
        unsigned char size[4];
        if (!input.read(reinterpret_cast<char *>(size), 4)) throw std::runtime_error("Truncated values file");
        const unsigned int length = unsigned(size[0]) | unsigned(size[1]) << 8 | unsigned(size[2]) << 16 | unsigned(size[3]) << 24;
        if (length > 32 * 1024 * 1024) throw std::runtime_error("Oversized tag value");
        std::string value(length, '\0');
        if (!input.read(value.data(), length)) throw std::runtime_error("Truncated tag value");
        return value;
      };
      while (input.peek() != std::char_traits<char>::eof()) {
        const auto key = readString();
        values[key] = readString();
      }
      if (values.empty()) throw std::runtime_error("Empty values file");
    } else {
      if ((argc - 3) % 2) throw std::runtime_error("Incomplete field pair");
      for (int i = 3; i < argc; i += 2) values[argv[i]] = argv[i + 1];
    }
    for (const auto &[key, value] : values) {
      if (value.empty() && key != "ALBUM" && key != "ALBUMARTIST") throw std::runtime_error("Empty database values must be omitted except ALBUM/ALBUMARTIST");
    }
    const std::string format(argv[1]);
    // TagLib 的 Windows 文件路径使用 UTF-16；字段值始终为 UTF-8。
#ifdef _WIN32
    const auto widePath = std::filesystem::u8path(argv[2]).wstring();
    const TagLib::FileName filePath(widePath.c_str());
#else
    const TagLib::FileName filePath(argv[2]);
#endif
    int removed = 0;
    if (format == "mp3") {
      TagLib::MPEG::File file(filePath, true);
      if (!file.isValid() || !file.audioProperties() || file.audioProperties()->sampleRate() <= 0) throw std::runtime_error("Invalid MP3 file");
      auto *tag = file.ID3v2Tag(true);
      const auto comments = tag->frameList("COMM");
      for (auto *frame : comments) {
        auto *comment = dynamic_cast<TagLib::ID3v2::CommentsFrame *>(frame);
        if (comment && comment->text().to8Bit(true).find("163 key") != std::string::npos) {
          tag->removeFrame(frame);
          removed++;
        }
      }
      const bool hasV1 = file.hasID3v1Tag();
      if (hasV1 && file.ID3v1Tag()->comment().to8Bit(true).find("163 key") != std::string::npos) {
        file.ID3v1Tag()->setComment(TagLib::String());
        removed++;
      }
      // 避免 ID3v2 的 TALB 删除后，读取器又从 ID3v1 回退出旧专辑名。
      if (hasV1 && values.count("ALBUM") && values.at("ALBUM").empty()) file.ID3v1Tag()->setAlbum(TagLib::String());
      applyValues(tag, values);
      const int selected = TagLib::MPEG::File::ID3v2 | (hasV1 ? TagLib::MPEG::File::ID3v1 : 0);
      if (!file.save(selected, TagLib::File::StripNone, TagLib::ID3v2::v4, TagLib::File::DoNotDuplicate)) throw std::runtime_error("MP3 save failed");
    }
    else if (format == "wav") {
      std::ifstream input(std::filesystem::u8path(argv[2]), std::ios::binary);
      char header[12] = {};
      if (!input.read(header, 12) || std::string(header, 4) != "RIFF" || std::string(header + 8, 4) != "WAVE") throw std::runtime_error("Invalid WAV header");
      input.close();
      TagLib::RIFF::WAV::File file(filePath, true);
      if (!file.isValid() || !file.audioProperties() || file.audioProperties()->sampleRate() <= 0) throw std::runtime_error("Invalid WAV file");
      applyValues(file.ID3v2Tag(), values);
      // 清除 INFO 的旧专辑名，避免删除 TALB 后回退；其他 INFO / BEXT / iXML 内容保留。
      const bool clearInfoAlbum = values.count("ALBUM") && values.at("ALBUM").empty() && file.hasInfoTag() && file.InfoTag()->fieldListMap().contains("IPRD");
      if (clearInfoAlbum) file.InfoTag()->removeField("IPRD");
      const auto selected = static_cast<TagLib::RIFF::WAV::File::TagTypes>(TagLib::RIFF::WAV::File::ID3v2 | (clearInfoAlbum ? TagLib::RIFF::WAV::File::Info : 0));
      if (!file.save(selected, TagLib::File::StripNone, TagLib::ID3v2::v4)) throw std::runtime_error("WAV save failed");
    }
    else if (format == "ogg") {
      TagLib::Ogg::Vorbis::File file(filePath, true);
      if (!file.isValid() || !file.audioProperties() || file.audioProperties()->sampleRate() <= 0) throw std::runtime_error("Invalid Ogg Vorbis file");
      file.setPacket(1, updateVorbisPacket(file.packet(1), values));
      if (!file.TagLib::Ogg::File::save()) throw std::runtime_error("Ogg save failed");
    }
    else if (format == "m4a") {
      TagLib::MP4::File file(filePath, true);
      if (!file.isValid() || !file.audioProperties() || file.audioProperties()->sampleRate() <= 0) throw std::runtime_error("Invalid M4A file");
      applyMp4Values(file.tag(), values);
      if (!file.save()) throw std::runtime_error("M4A save failed");
    }
    else throw std::runtime_error("Unsupported format");
    std::cout << "{\"removedComments\":" << removed << "}\n";
    return 0;
  }
  catch (const std::exception &error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}

int main(int argc, char **argv) {
#ifdef _WIN32
  int count = 0;
  auto **wideArgs = CommandLineToArgvW(GetCommandLineW(), &count);
  if (!wideArgs) return 1;
  std::vector<std::string> strings;
  for (int i = 0; i < count; i++) {
    const int length = WideCharToMultiByte(CP_UTF8, 0, wideArgs[i], -1, nullptr, 0, nullptr, nullptr);
    std::string value(length, '\0');
    WideCharToMultiByte(CP_UTF8, 0, wideArgs[i], -1, value.data(), length, nullptr, nullptr);
    value.pop_back(); strings.push_back(value);
  }
  LocalFree(wideArgs);
  std::vector<char *> utf8Args;
  for (auto &value : strings) utf8Args.push_back(value.data());
  return runWriter(count, utf8Args.data());
#else
  return runWriter(argc, argv);
#endif
}
