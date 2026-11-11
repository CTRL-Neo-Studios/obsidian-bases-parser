/**
 * Obsidian Bases Examples
 *
 * Example bases, filters and formulas, as plain data: importing them runs nothing. The walkthrough that tokenizes,
 * parses, evaluates and queries them (and logs what it gets) is `examples/walkthrough.ts`.
 */

import { ObsidianBase, Filter } from './obsidian-bases-schema';
import {
  PresetFilters,
  PresetFormulas,
  PresetSummaries,
  createBase,
  createFilter,
  and,
  or,
  not,
} from './obsidian-bases-utils';

// =============================================================================
// EXAMPLE 1: Task Tracker Base
// =============================================================================

export const taskTrackerBase: ObsidianBase = {
  filters: {
    and: [
      'file.hasTag("task")',
      'file.ext == "md"',
    ],
  },
  formulas: {
    days_until_due: 'if(due, ((date(due) - today()) / 86400000).round(0), "")',
    is_overdue: 'if(due, date(due) < today() && status != "done", false)',
    priority_label: 'if(priority == 1, "🔴 High", if(priority == 2, "🟡 Medium", "🟢 Low"))',
  },
  properties: {
    status: { displayName: 'Status' },
    'formula.days_until_due': { displayName: 'Days Until Due' },
    'formula.priority_label': { displayName: 'Priority' },
  },
  views: [
    {
      type: 'table',
      name: 'Active Tasks',
      filters: {
        and: ['status != "done"'],
      },
      order: [
        'file.name',
        'status',
        'formula.priority_label',
        'due',
        'formula.days_until_due',
      ],
      groupBy: {
        property: 'status',
        direction: 'ASC',
      },
      summaries: {
        'formula.days_until_due': 'Average',
      },
    },
    {
      type: 'table',
      name: 'Completed',
      filters: {
        and: ['status == "done"'],
      },
      order: [
        'file.name',
        'completed_date',
      ],
    },
  ],
};

// =============================================================================
// EXAMPLE 2: Reading List Base (using builder)
// =============================================================================

export const readingListBase = createBase()
  .withFilters(
    or(
      'file.hasTag("book")',
      'file.hasTag("article")'
    ).build()
  )
  .addFormula('reading_time', 'if(pages, (pages * 2).toString() + " min", "")')
  .addFormula('status_icon', 'if(status == "reading", "📖", if(status == "done", "✅", "📚"))')
  .addFormula('year_read', 'if(finished_date, date(finished_date).year, "")')
  .configureProperty('author', { displayName: 'Author' })
  .configureProperty('formula.status_icon', { displayName: '' })
  .configureProperty('formula.reading_time', { displayName: 'Est. Time' })
  .addCardsView('Library', {
    order: ['cover', 'file.name', 'author', 'formula.status_icon'],
    filters: not('status == "dropped"').build(),
  })
  .addTableView('Reading List', {
    order: ['file.name', 'author', 'pages', 'formula.reading_time'],
    filters: and('status == "to-read"').build(),
  })
  .build();

// =============================================================================
// EXAMPLE 3: Project Notes Base (using presets)
// =============================================================================

export const projectNotesBase = createBase()
  .withFilters(
    and(
      PresetFilters.inFolder('Projects'),
      PresetFilters.byExtension('md')
    ).build()
  )
  .addFormula('last_updated', PresetFormulas.lastModified())
  .addFormula('link_count', PresetFormulas.linkCount())
  .addSummary('avgLinks', PresetSummaries.customAverage(1))
  .configureProperty('formula.last_updated', { displayName: 'Updated' })
  .configureProperty('formula.link_count', { displayName: 'Links' })
  .addTableView('All Projects', {
    order: ['file.name', 'status', 'formula.last_updated', 'formula.link_count'],
    summaries: { 'formula.link_count': 'avgLinks' },
    groupBy: { property: 'status', direction: 'ASC' },
  })
  .addListView('Quick List', {
    order: ['file.name', 'status'],
  })
  .build();

// =============================================================================
// EXAMPLE 4: Daily Notes Index
// =============================================================================

export const dailyNotesBase: ObsidianBase = {
  filters: {
    and: [
      'file.inFolder("Daily Notes")',
      '/^\\d{4}-\\d{2}-\\d{2}$/.matches(file.basename)',
    ],
  },
  formulas: {
    word_estimate: '(file.size / 5).round(0)',
    day_of_week: 'date(file.basename).format("dddd")',
  },
  properties: {
    'formula.day_of_week': { displayName: 'Day' },
    'formula.word_estimate': { displayName: '~Words' },
  },
  views: [
    {
      type: 'table',
      name: 'Recent Notes',
      limit: 30,
      order: [
        'file.name',
        'formula.day_of_week',
        'formula.word_estimate',
        'file.mtime',
      ],
    },
  ],
};

// =============================================================================
// EXAMPLE 5: Complex Filter with Nested Logic
// =============================================================================

export const complexFilter: Filter = {
  or: [
    'file.hasTag("important")',
    {
      and: [
        'priority >= 3',
        'status == "active"',
        {
          not: [
            'file.hasTag("archived")',
            'file.inFolder("Archive")',
          ],
        },
      ],
    },
    {
      and: [
        'file.mtime > now() - "7d"',
        'file.hasTag("recent")',
      ],
    },
  ],
};

// =============================================================================
// EXAMPLE 6: Using Filter Builder
// =============================================================================

export const builtFilter = createFilter()
  .and(PresetFilters.byTag('project'))
  .and(PresetFilters.byExtension('md'))
  .and(PresetFilters.modifiedWithin(30))
  .not(PresetFilters.byTag('archived'))
  .build();

// =============================================================================
// EXAMPLE 11: Advanced Formula Examples
// =============================================================================

export const advancedFormulas = {
  // Date arithmetic
  daysOld: '((now() - file.ctime) / 86400000).round(0)',
  nextWeek: 'today() + "7d"',
  lastMonth: 'now() - "1M"',

  // Conditional with multiple branches
  statusColor: 'if(status == "done", "green", if(status == "in-progress", "yellow", "red"))',

  // String manipulation
  displayName: 'file.basename.title()',
  truncated: 'description.slice(0, 50) + "..."',

  // List operations
  tagCount: 'file.tags.length',
  firstTag: 'file.tags[0]',

  // Complex calculations
  progressPercent: '(completed / total * 100).round(1) + "%"',

  // Using file methods
  hasRequiredTag: 'file.hasTag("required") || file.hasTag("mandatory")',
  inActiveFolder: 'file.inFolder("Active") && !file.inFolder("Active/Archive")',

  // Regular expressions
  isDailyNote: '/^\\d{4}-\\d{2}-\\d{2}$/.matches(file.basename)',
  containsLink: '/\\[\\[.+\\]\\]/.matches(file.content)',
};

// =============================================================================
// EXAMPLE 12: Complete Base with All Features
// =============================================================================

export const completeBase: ObsidianBase = {
  // Global filters
  filters: {
    and: [
      'file.ext == "md"',
      'file.hasTag("note")',
      {
        not: [
          'file.hasTag("template")',
          'file.hasTag("archive")',
        ],
      },
    ],
  },

  // Formula properties
  formulas: {
    age_days: '((now() - file.ctime) / 86400000).round(0)',
    modified_ago: 'file.mtime.relative()',
    is_recent: 'file.mtime > now() - "7d"',
    word_estimate: '(file.size / 5).round(0)',
    tag_summary: 'file.tags.join(", ")',
    link_count: 'file.links.length',
    backlink_count: 'file.backlinks.length',
    priority_icon: 'if(priority == 1, "🔴", if(priority == 2, "🟡", if(priority == 3, "🟢", "⚪")))',
    status_badge: 'if(status == "done", "✅ Done", if(status == "in-progress", "🔄 In Progress", "⏳ Todo"))',
  },

  // Property configurations
  properties: {
    status: { displayName: 'Status' },
    priority: { displayName: 'Priority' },
    due: { displayName: 'Due Date' },
    'formula.age_days': { displayName: 'Age (days)' },
    'formula.modified_ago': { displayName: 'Last Modified' },
    'formula.word_estimate': { displayName: '~Words' },
    'formula.tag_summary': { displayName: 'Tags' },
    'formula.priority_icon': { displayName: '' },
    'formula.status_badge': { displayName: 'Status' },
  },

  // Custom summaries
  summaries: {
    avgAge: 'values.filter(v => v.isType("number")).mean().round(1)',
    totalWords: 'values.filter(v => v.isType("number")).sum()',
    uniqueTags: 'values.flat().unique().length',
  },

  // Views
  views: [
    {
      type: 'table',
      name: 'All Notes',
      order: [
        'file.name',
        'formula.priority_icon',
        'formula.status_badge',
        'due',
        'formula.modified_ago',
        'formula.word_estimate',
      ],
      groupBy: {
        property: 'status',
        direction: 'ASC',
      },
      summaries: {
        'formula.age_days': 'avgAge',
        'formula.word_estimate': 'totalWords',
      },
    },
    {
      type: 'table',
      name: 'Recent Only',
      limit: 20,
      filters: {
        and: ['formula.is_recent == true'],
      },
      order: [
        'file.mtime',
        'file.name',
        'formula.word_estimate',
      ],
    },
    {
      type: 'cards',
      name: 'Note Gallery',
      order: [
        'file.name',
        'formula.status_badge',
        'formula.tag_summary',
      ],
    },
    {
      type: 'list',
      name: 'Quick List',
      order: [
        'formula.priority_icon',
        'file.name',
      ],
      filters: {
        and: ['status != "done"'],
      },
    },
  ],
};


// =============================================================================
// EXAMPLE 13: Export all examples
// =============================================================================

export const examples = {
  taskTrackerBase,
  readingListBase,
  projectNotesBase,
  dailyNotesBase,
  complexFilter,
  builtFilter,
  advancedFormulas,
  completeBase,
};

export default examples;
