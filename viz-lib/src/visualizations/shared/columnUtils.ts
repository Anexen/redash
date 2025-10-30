import _ from "lodash";
import { visualizationsSettings } from "@/visualizations/visualizationsSettings";

const filterTypes = ["filter", "multi-filter", "multiFilter"];

export function getColumnNameWithoutType(column: any) {
  let typeSplit;
  if (column.indexOf("::") !== -1) {
    typeSplit = "::";
  } else if (column.indexOf("__") !== -1) {
    typeSplit = "__";
  } else {
    return column;
  }

  const parts = column.split(typeSplit);
  if (parts[0] === "" && parts.length === 2) {
    return parts[1];
  }

  if (!_.includes(filterTypes, parts[1])) {
    return column;
  }

  return parts[0];
}

export function getColumnContentAlignment(type: any) {
  return ["integer", "float", "boolean", "date", "datetime"].indexOf(type) >= 0 ? "right" : "left";
}

export function getDefaultColumnsOptions(columns: any, extraFields = {}) {
  const displayAs = {
    integer: "number",
    float: "number",
    boolean: "boolean",
    date: "datetime",
    datetime: "datetime",
  };

  const defaultFields = {
    // `string` cell options
    allowHTML: false,
    highlightLinks: false,
  };

  return _.map(columns, (col, index) => ({
    name: col.name,
    type: col.type,
    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    displayAs: displayAs[col.type] || "string",
    visible: true,
    order: 100000 + index,
    title: getColumnNameWithoutType(col.name),
    alignContent: getColumnContentAlignment(col.type),
    description: "",
    ...defaultFields,
    ...extraFields,
  }));
}

export function getDefaultFormatOptions(column: any) {
  const dateTimeFormat = {
    date: visualizationsSettings.dateFormat || "DD/MM/YYYY",
    datetime: visualizationsSettings.dateTimeFormat || "DD/MM/YYYY HH:mm",
  };
  const numberFormat = {
    integer: visualizationsSettings.integerFormat || "0,0",
    float: visualizationsSettings.floatFormat || "0,0.00",
  };
  return {
    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    dateTimeFormat: dateTimeFormat[column.type],
    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    numberFormat: numberFormat[column.type],
    nullValue: visualizationsSettings.nullValue,
    booleanValues: visualizationsSettings.booleanValues || ["false", "true"],
    // `image` cell options
    imageUrlTemplate: "{{ @ }}",
    imageTitleTemplate: "{{ @ }}",
    imageWidth: "",
    imageHeight: "",
    // `link` cell options
    linkUrlTemplate: "{{ @ }}",
    linkTextTemplate: "{{ @ }}",
    linkTitleTemplate: "{{ @ }}",
    linkOpenInNewTab: true,
  };
}

export function wereColumnsReordered(queryColumns: any, visualizationColumns: any) {
  queryColumns = _.map(queryColumns, (col) => col.name);
  visualizationColumns = _.map(visualizationColumns, (col) => col.name);

  // Some columns may be removed - so skip them (but keep original order)
  visualizationColumns = _.filter(visualizationColumns, (col) => _.includes(queryColumns, col));
  // Pick query columns that were previously saved with viz (but keep order too)
  queryColumns = _.filter(queryColumns, (col) => _.includes(visualizationColumns, col));

  // Both array now have the same size as they both contains only common columns
  // (in fact, it was an intersection, that kept order of items on both arrays).
  // Now check for equality item-by-item; if common columns are in the same order -
  // they were not reordered in editor
  for (let i = 0; i < queryColumns.length; i += 1) {
    if (visualizationColumns[i] !== queryColumns[i]) {
      return true;
    }
  }
  return false;
}

export function getColumnsOptions(columns: any, visualizationColumns: any, extraFields = {}) {
  const options = getDefaultColumnsOptions(columns, extraFields);
  visualizationColumns ??= [];

  if (wereColumnsReordered(columns, visualizationColumns)) {
    if (columns.length === visualizationColumns.length) {
      visualizationColumns = _.fromPairs(
        _.map(visualizationColumns, (col, index) => [col.name, _.extend({}, col, { order: index })])
      );
    } else {
      const orderedNames = computeSmartColumnOrder(columns, visualizationColumns);
      const nameToOrder = _.fromPairs(_.map(orderedNames, (name, index) => [name, { order: index }]));

      _.each(options, (col) => _.extend(col, nameToOrder[col.name]));
      visualizationColumns = _.fromPairs(_.map(visualizationColumns, (col) => [col.name, _.omit(col, "order")]));
    }
  } else {
    visualizationColumns = _.fromPairs(_.map(visualizationColumns, (col) => [col.name, _.omit(col, "order")]));
  }

  _.each(options, (col) => _.extend(col, visualizationColumns[col.name]));

  return _.sortBy(options, "order");
}

// Merge saved visualization order with live query order, preserving user
// constraints while keeping untouched columns in their natural data sequence.
function computeSmartColumnOrder(queryColumns: any, visualizationColumns: any): string[] {
  const columnNames = _.map(queryColumns, "name");

  if (columnNames.length <= 1) {
    return columnNames;
  }

  const visualizationOrder = _.chain(visualizationColumns)
    .orderBy("order")
    .map("name")
    .intersection(columnNames)
    .value();

  if (visualizationOrder.length <= 1) {
    return columnNames;
  }

  const graph = buildOrderGraph(columnNames, visualizationOrder);
  return topologicalSort(columnNames, graph);
}

interface OrderGraph {
  indegree: Map<string, number>;
  successor: Map<string, string>;
}

function buildOrderGraph(nodes: string[], visualizationOrder: string[]): OrderGraph {
  const indegree = new Map(_.map(nodes, (v) => [v, 0]));
  const successor = new Map();

  let previous = visualizationOrder[0];
  for (let i = 1; i < visualizationOrder.length; i += 1) {
    const current = visualizationOrder[i];
    if (current === previous) {
      continue;
    }

    if (!successor.has(previous)) {
      successor.set(previous, current);
      // @ts-expect-error: every successor comes from `nodes`,
      // so indegree always has this key
      indegree.set(current, indegree.get(current) + 1);
    }

    previous = current;
  }

  return { indegree, successor };
}

function topologicalSort(nodes: string[], graph: OrderGraph): string[] {
  const dataIndex = new Map(_.map(nodes, (v, i) => [v, i]));
  const available = _.filter(nodes, (v) => graph.indegree.get(v) === 0);
  const result = [];

  while (available.length > 0) {
    const nextName = _.minBy(available, (v) => dataIndex.get(v));

    if (!nextName) {
      break;
    }

    available.splice(available.indexOf(nextName), 1);
    result.push(nextName);

    const nextNode = graph.successor.get(nextName);

    if (nextNode) {
      // @ts-expect-error: every successor comes from `nodes`,
      // so indegree always has this key
      const updated = graph.indegree.get(nextNode) - 1;
      graph.indegree.set(nextNode, updated);
      if (updated === 0) {
        available.push(nextNode);
      }
    }
  }

  return result;
}
