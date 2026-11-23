import assert from 'node:assert/strict'
import { test } from 'node:test'
import { orderTagsForDisplay } from '../src/shared/tagOrdering'

const names = (values: string[], type: string): string[] =>
  orderTagsForDisplay(values.map((name) => ({ name })), type).map((item) => item.name)

test('Month tags sort by numeric year and month, not lexicographic text', () => {
  assert.deepEqual(names(['2025.10', '2024.11', '2025.2', '2025.1', '2024.10'], 'Month'), [
    '2024.10', '2024.11', '2025.1', '2025.2', '2025.10'
  ])
})

test('Year tags sort chronologically by year value', () => {
  assert.deepEqual(names(['2026', '2024', '2025'], 'Year'), ['2024', '2025', '2026'])
})

test('ordinary Tag categories remain alphabetically sorted', () => {
  assert.deepEqual(names(['sorrow', 'Ambient', 'Inspire', 'dark'], 'Mood'), ['Ambient', 'dark', 'Inspire', 'sorrow'])
})

test('invalid Month and Year names remain visible after valid dates', () => {
  assert.deepEqual(names(['unknown', '2025.13', '2025.2', '2024.12'], 'Month'), ['2024.12', '2025.2', '2025.13', 'unknown'])
  assert.deepEqual(names(['TBD', '2025', '2024'], 'Year'), ['2024', '2025', 'TBD'])
})
