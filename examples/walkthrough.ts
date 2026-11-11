/**
 * A walkthrough of the library: tokenizing, parsing, evaluating, validating and serializing, then reactive queries
 * over the example bases (`src/obsidian-bases-example.ts`). It logs what it gets. Not part of the package build; run
 * it with `bun examples/walkthrough.ts`.
 */

import {
  ObsidianBase,
  ExecutionContext,
  FileContext,
  BaseSource,
  Lexer,
  Parser,
  parseFilterExpression,
  evaluateFilter,
  evaluateFormula,
  validateFilter,
  validateFormula,
  serializeToYAML,
  ReactiveBaseQuery,
  useBaseQuery,
  useBaseView,
  readBase,
  createBaseQuery,
  createBaseQueryFromYAML,
  taskTrackerBase,
} from '../src';

import { ref, computed } from 'vue';

// =============================================================================
// EXAMPLE 7: Parser Usage
// =============================================================================

// Tokenize an expression
const expression = 'file.hasTag("book") && status == "reading"';
const lexer = new Lexer(expression);
const tokens = lexer.tokenize();
console.log('Tokens:', tokens);

// Parse into AST
const parser = new Parser(tokens);
const parseResult = parser.parse();
console.log('Parse result:', parseResult);

// =============================================================================
// EXAMPLE 7b: FilterExpObject Usage
// =============================================================================

// Parse a filter expression into a FilterExpObject with extracted components
const filterExp = parseFilterExpression('file.hasTag("book") && status == "reading"');

// Check if the filter uses specific file methods
if (filterExp.fileMethods.includes('hasTag')) {
  console.log('Tags referenced:', filterExp.referencedTags); // ['book']
}

// Check if specific properties are used
if (filterExp.noteProperties.includes('status')) {
  console.log('Filter uses status property');
}

// Access comparison operations
for (const comparison of filterExp.comparisons) {
  const leftName = 'name' in comparison.left ? comparison.left.name : 
                   'raw' in comparison.left ? comparison.left.raw : String(comparison.left);
  const rightValue = 'raw' in comparison.right ? comparison.right.raw :
                     'name' in comparison.right ? comparison.right.name : String(comparison.right);
  console.log(`Comparison: ${leftName} ${comparison.operator} ${rightValue}`);
  // Output: "status == reading"
}

// Check expression type
if (filterExp.expressionType === 'boolean') {
  console.log('This is a boolean expression with && or ||');
}

// Access all properties
console.log('File properties:', filterExp.fileProperties); // []
console.log('Note properties:', filterExp.noteProperties); // ['status']
console.log('Formula properties:', filterExp.formulaProperties); // []

// Check for date arithmetic
const dateFilter = parseFilterExpression('file.mtime > now() - "7d"');
if (dateFilter.hasDateArithmetic) {
  console.log('Filter uses date arithmetic');
}

// More complex example
const complexExp = parseFilterExpression('priority > 3 && file.inFolder("Projects") && !file.hasTag("archived")');

// Use in conditional logic
if (complexExp.fileMethods.includes('inFolder')) {
  console.log('Folders referenced:', complexExp.referencedFolders); // ['Projects']
}

if (complexExp.hasBooleanOperators) {
  console.log('Has boolean operators');
}

if (complexExp.usesThisReference) {
  console.log('Uses "this" reference');
}

// =============================================================================
// EXAMPLE 8: Evaluator Usage
// =============================================================================

// Create execution context
const mockFile: FileContext = {
  name: 'My Note.md',
  basename: 'My Note',
  path: 'Notes/My Note.md',
  folder: 'Notes',
  ext: 'md',
  size: 1024,
  ctime: new Date('2024-01-15'),
  mtime: new Date('2024-01-20'),
  tags: ['book', 'reading'],
  links: ['[[Other Note]]'],
  backlinks: [],
  embeds: [],
  properties: {
    status: 'reading',
    priority: 2,
  },
};

const context: ExecutionContext = {
  file: mockFile,
  note: {
    status: 'reading',
    priority: 2,
    due: '2024-02-01',
  },
  formula: {},
};

// Evaluate a filter
const filterResult = evaluateFilter('file.hasTag("book")', context);
console.log('Filter result:', filterResult); // { type: 'BOOLEAN', value: true }

// Evaluate a formula
const formulaResult = evaluateFormula('priority * 10', context);
console.log('Formula result:', formulaResult); // { type: 'NUMBER', value: 20 }

// =============================================================================
// EXAMPLE 9: Validation
// =============================================================================

// Validate a filter
const filterValidation = validateFilter({
  and: ['status == "done"', 'priority > 3'],
});
console.log('Filter validation:', filterValidation);

// Validate a formula
const formulaValidation = validateFormula('if(done, "Yes", "No")');
console.log('Formula validation:', formulaValidation);

// =============================================================================
// EXAMPLE 10: YAML Serialization
// =============================================================================

// Serialize a base to YAML
const yamlOutput = serializeToYAML(taskTrackerBase);
console.log('YAML Output:');
console.log(yamlOutput);

// =============================================================================
// EXAMPLE 13: Reactive Base Query Examples
// =============================================================================

// Define custom data type
interface Task {
  title: string;
  description?: string;
  assignee?: string;
}

// Create reactive source
const taskSource = ref<BaseSource<Task>[]>([
  {
    id: '1',
    name: 'Task 1.md',
    basename: 'Task 1',
    path: 'Tasks/Task 1.md',
    folder: 'Tasks',
    ext: 'md',
    tags: ['task', 'urgent'],
    properties: {
      status: 'todo',
      priority: 1,
      due: '2024-12-31',
    },
    data: {
      title: 'Complete documentation',
      description: 'Write the user guide',
      assignee: 'Alice',
    },
  },
  {
    id: '2',
    name: 'Task 2.md',
    basename: 'Task 2',
    path: 'Tasks/Task 2.md',
    folder: 'Tasks',
    ext: 'md',
    tags: ['task'],
    properties: {
      status: 'in-progress',
      priority: 2,
      due: '2024-12-25',
    },
    data: {
      title: 'Fix bugs',
      description: 'Address reported issues',
      assignee: 'Bob',
    },
  },
  {
    id: '3',
    name: 'Task 3.md',
    basename: 'Task 3',
    path: 'Archive/Task 3.md',
    folder: 'Archive',
    ext: 'md',
    tags: ['task', 'archived'],
    properties: {
      status: 'done',
      priority: 3,
    },
    data: {
      title: 'Initial setup',
      description: 'Project initialization',
      assignee: 'Charlie',
    },
  },
]);

// YAML base definition
const taskBaseYAML = `
filters:
  and:
    - file.hasTag("task")
    - '!file.hasTag("archived")'
formulas:
  days_until_due: 'if(due, ((date(due) - today()) / 86400000).round(0), "")'
  is_overdue: 'if(due, date(due) < today() && status != "done", false)'
  priority_label: 'if(priority == 1, "🔴 High", if(priority == 2, "🟡 Medium", "🟢 Low"))'
properties:
  status:
    displayName: Status
  formula.days_until_due:
    displayName: Days Left
  formula.priority_label:
    displayName: Priority
views:
  - type: table
    name: "Active Tasks"
    filters:
      and:
        - status != "done"
    order:
      - file.name
      - status
      - formula.priority_label
      - due
      - formula.days_until_due
    groupBy:
      property: status
      direction: ASC
    summaries:
      formula.days_until_due: Average
  - type: table
    name: "Completed"
    filters:
      and:
        - status == "done"
    order:
      - file.name
      - completed_date
`;

// Example 13a: Read base from YAML
const parsedBase = readBase(taskBaseYAML);
console.log('Parsed base:', parsedBase);

// Example 13b: Create reactive query
const query = new ReactiveBaseQuery(taskSource, parsedBase, { debug: true });

// Example 13c: Get reactive results for a view
const activeTasks = query.getViewResults('Active Tasks');
const completedTasks = query.getViewResults('Completed');

// Access reactive data
console.log('Active tasks:', activeTasks.value.items);
console.log('Total count:', activeTasks.value.totalCount);
console.log('Groups:', activeTasks.value.groups);
console.log('Summaries:', activeTasks.value.summaries);

// Example 13d: Using Vue composable (in a component)
function useTaskManager() {
  // Using the composable
  const { getViewResults, getAllResults, refresh, source, base } = useBaseQuery(
    taskSource,
    parsedBase,
    { debug: true }
  );

  // Get reactive results
  const activeTasks = getViewResults('Active Tasks');
  const allTasks = getAllResults();

  // Computed for template use
  const activeTaskCount = computed(() => activeTasks.value.totalCount);
  const hasOverdueTasks = computed(() =>
    activeTasks.value.items.some(item => item.properties?.is_overdue)
  );

  // Method to add a new task
  function addTask(task: BaseSource<Task>) {
    source.value.push(task);
    // Results automatically update due to reactivity
  }

  // Method to update a task
  function updateTask(id: string, updates: Partial<BaseSource<Task>>) {
    const index = source.value.findIndex(t => t.id === id);
    if (index !== -1) {
      source.value[index] = { ...source.value[index], ...updates };
      // Results automatically update due to reactivity
    }
  }

  // Method to refresh manually
  function forceRefresh() {
    refresh();
  }

  return {
    activeTasks,
    allTasks,
    activeTaskCount,
    hasOverdueTasks,
    addTask,
    updateTask,
    forceRefresh,
  };
}

// Example 13e: Using useBaseView composable for single view
function useActiveTasksOnly() {
  const { items, totalCount, groups, summaries, isProcessing, errors, refresh } =
    useBaseView(taskSource, parsedBase, 'Active Tasks');

  // items is a ComputedRef - automatically updates when source changes
  // Use in template: v-for="task in items" :key="task.id"

  return {
    tasks: items,
    count: totalCount,
    grouped: groups,
    summaryData: summaries,
    loading: isProcessing,
    errorMessages: errors,
    refresh,
  };
}

// Example 13f: Create query from YAML directly
const yamlQuery = createBaseQueryFromYAML(taskSource, taskBaseYAML, { debug: true });

// Example 13g: Create query from base object
const objectQuery = createBaseQuery(taskSource, taskTrackerBase);

// =============================================================================
// EXAMPLE 14: Advanced Reactive Patterns
// =============================================================================

// Pattern 1: Multiple views with shared source
function useMultiViewDashboard() {
  const source = ref<BaseSource[]>([/* ... */]);
  const base = readBase(`
    views:
      - type: table
        name: "All Items"
        order: [file.name]
      - type: cards
        name: "Gallery"
        order: [file.name, cover]
      - type: list
        name: "Quick List"
        limit: 10
  `);

  const query = new ReactiveBaseQuery(source, base);

  return {
    tableView: query.getViewResults('All Items'),
    cardsView: query.getViewResults('Gallery'),
    listView: query.getViewResults('Quick List'),
    source,
  };
}

// Pattern 2: Dynamic base switching
function useDynamicBase() {
  const source = ref<BaseSource[]>([/* ... */]);
  const currentBaseName = ref('tasks');

  const bases: Record<string, ObsidianBase> = {
    tasks: readBase(`
      filters:
        and:
          - file.hasTag("task")
      views:
        - type: table
          name: "Tasks"
          order: [file.name, status]
    `),
    notes: readBase(`
      filters:
        and:
          - file.hasTag("note")
      views:
        - type: cards
          name: "Notes"
          order: [file.name, content]
    `),
  };

  const currentBase = computed(() => bases[currentBaseName.value]);
  const query = new ReactiveBaseQuery(source, currentBase);

  function switchBase(name: string) {
    currentBaseName.value = name;
    // Query automatically updates due to reactive base
  }

  return {
    results: query.getAllResults(),
    switchBase,
    currentBaseName,
  };
}

// Pattern 3: Custom formula functions
function useCustomFunctions() {
  const source = ref<BaseSource[]>([/* ... */]);

  const base = readBase(`
    formulas:
      custom_score: 'calculateScore(priority, complexity)'
    views:
      - type: table
        name: "Scored Items"
        order: [formula.custom_score]
  `);

  const query = new ReactiveBaseQuery(source, base, {
    customFunctions: {
      calculateScore: (priority: number, complexity: number) => {
        return priority * complexity * 10;
      },
    },
  });

  return query.getViewResults('Scored Items');
}

// Pattern 4: Reactive filtering with user input
function useSearchableList() {
  const source = ref<BaseSource[]>([/* ... */]);
  const searchQuery = ref('');

  const base = computed(() => readBase(`
    filters:
      ${searchQuery.value ? `and:
        - 'file.name.contains("${searchQuery.value}")'` : ''}
    views:
      - type: list
        name: "Search Results"
        order: [file.name]
  `));

  const query = new ReactiveBaseQuery(source, base);

  return {
    results: query.getViewResults('Search Results'),
    searchQuery,
  };
}

