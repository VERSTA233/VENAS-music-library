#include <node_api.h>
#include <cmath>
#include <mutex>
#include <string>
#import <MediaPlayer/MediaPlayer.h>

namespace {
std::mutex callbackMutex;
napi_threadsafe_function callback = nullptr;
id playTarget = nil;
id pauseTarget = nil;
id toggleTarget = nil;
id nextTarget = nil;
id previousTarget = nil;

void callJavaScript(napi_env env, napi_value function, void*, void* data) {
  if (!env || !function) return;
  napi_value command;
  if (napi_create_string_utf8(env, static_cast<const char*>(data), NAPI_AUTO_LENGTH, &command) != napi_ok) return;
  napi_value global;
  if (napi_get_global(env, &global) == napi_ok) napi_call_function(env, global, function, 1, &command, nullptr);
}

MPRemoteCommandHandlerStatus sendCommand(const char* command) {
  std::lock_guard<std::mutex> lock(callbackMutex);
  if (!callback || napi_acquire_threadsafe_function(callback) != napi_ok) return MPRemoteCommandHandlerStatusCommandFailed;
  const napi_status status = napi_call_threadsafe_function(callback, const_cast<char*>(command), napi_tsfn_nonblocking);
  napi_release_threadsafe_function(callback, napi_tsfn_release);
  return status == napi_ok ? MPRemoteCommandHandlerStatusSuccess : MPRemoteCommandHandlerStatusCommandFailed;
}

void disposeBridge() {
  @autoreleasepool {
    MPRemoteCommandCenter* center = [MPRemoteCommandCenter sharedCommandCenter];
    if (playTarget) [center.playCommand removeTarget:playTarget];
    if (pauseTarget) [center.pauseCommand removeTarget:pauseTarget];
    if (toggleTarget) [center.togglePlayPauseCommand removeTarget:toggleTarget];
    if (nextTarget) [center.nextTrackCommand removeTarget:nextTarget];
    if (previousTarget) [center.previousTrackCommand removeTarget:previousTarget];
    playTarget = pauseTarget = toggleTarget = nextTarget = previousTarget = nil;
    MPNowPlayingInfoCenter* info = [MPNowPlayingInfoCenter defaultCenter];
    info.playbackState = MPNowPlayingPlaybackStateStopped;
    info.nowPlayingInfo = nil;
  }
  std::lock_guard<std::mutex> lock(callbackMutex);
  if (callback) {
    napi_release_threadsafe_function(callback, napi_tsfn_release);
    callback = nullptr;
  }
}

void cleanup(void*) { disposeBridge(); }

napi_value initialize(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  napi_valuetype type;
  if (argc != 1 || napi_typeof(env, argv[0], &type) != napi_ok || type != napi_function) {
    napi_throw_type_error(env, nullptr, "initialize expects a command callback");
    return nullptr;
  }
  disposeBridge();
  napi_value name;
  napi_create_string_utf8(env, "VENAS remote commands", NAPI_AUTO_LENGTH, &name);
  if (napi_create_threadsafe_function(env, argv[0], nullptr, name, 0, 1, nullptr, nullptr, nullptr, callJavaScript, &callback) != napi_ok) {
    napi_throw_error(env, nullptr, "Could not initialize macOS remote commands");
    return nullptr;
  }
  @autoreleasepool {
    MPRemoteCommandCenter* center = [MPRemoteCommandCenter sharedCommandCenter];
    playTarget = [center.playCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent*) { return sendCommand("play"); }];
    pauseTarget = [center.pauseCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent*) { return sendCommand("pause"); }];
    toggleTarget = [center.togglePlayPauseCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent*) { return sendCommand("toggle"); }];
    nextTarget = [center.nextTrackCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent*) { return sendCommand("next"); }];
    previousTarget = [center.previousTrackCommand addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent*) { return sendCommand("previous"); }];
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value property(napi_env env, napi_value object, const char* key) {
  napi_value value;
  return napi_get_named_property(env, object, key, &value) == napi_ok ? value : nullptr;
}

NSString* textProperty(napi_env env, napi_value object, const char* key) {
  napi_value value = property(env, object, key);
  napi_valuetype type;
  if (!value || napi_typeof(env, value, &type) != napi_ok || type != napi_string) return @"";
  size_t size = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &size);
  std::string bytes(size + 1, '\0');
  napi_get_value_string_utf8(env, value, bytes.data(), bytes.size(), &size);
  return [NSString stringWithUTF8String:bytes.c_str()] ?: @"";
}

double numberProperty(napi_env env, napi_value object, const char* key) {
  napi_value value = property(env, object, key);
  double number = 0;
  return value && napi_get_value_double(env, value, &number) == napi_ok && std::isfinite(number) && number > 0 ? number : 0;
}

napi_value update(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  @autoreleasepool {
    MPNowPlayingInfoCenter* center = [MPNowPlayingInfoCenter defaultCenter];
    napi_valuetype type = napi_undefined;
    if (argc == 0 || napi_typeof(env, argv[0], &type) != napi_ok || type == napi_null) {
      center.playbackState = MPNowPlayingPlaybackStateStopped;
      center.nowPlayingInfo = nil;
    } else if (type == napi_object) {
      napi_value playingValue = property(env, argv[0], "playing");
      bool playing = false;
      if (playingValue) napi_get_value_bool(env, playingValue, &playing);
      NSMutableDictionary<NSString*, id>* details = [NSMutableDictionary dictionary];
      details[MPMediaItemPropertyTitle] = textProperty(env, argv[0], "title");
      NSString* artist = textProperty(env, argv[0], "artist");
      if (artist.length) details[MPMediaItemPropertyArtist] = artist;
      const double duration = numberProperty(env, argv[0], "duration");
      if (duration) details[MPMediaItemPropertyPlaybackDuration] = @(duration);
      details[MPNowPlayingInfoPropertyElapsedPlaybackTime] = @(numberProperty(env, argv[0], "position"));
      details[MPNowPlayingInfoPropertyPlaybackRate] = @(playing ? 1.0 : 0.0);
      details[MPNowPlayingInfoPropertyMediaType] = @(MPNowPlayingInfoMediaTypeAudio);
      center.nowPlayingInfo = details;
      // macOS requires every play/pause transition to be reported explicitly.
      center.playbackState = playing ? MPNowPlayingPlaybackStatePlaying : MPNowPlayingPlaybackStatePaused;
    } else {
      napi_throw_type_error(env, nullptr, "update expects now-playing data or null");
      return nullptr;
    }
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value dispose(napi_env env, napi_callback_info) {
  disposeBridge();
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor descriptors[] = {
    {"initialize", nullptr, initialize, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"update", nullptr, update, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"dispose", nullptr, dispose, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  napi_define_properties(env, exports, 3, descriptors);
  napi_add_env_cleanup_hook(env, cleanup, nullptr);
  return exports;
}
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
