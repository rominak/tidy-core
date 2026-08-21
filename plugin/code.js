/**
 * tidy-core bridge plugin.
 *
 * The plugin sandbox has the Figma API but no WebSocket, and the UI iframe has
 * WebSocket but no Figma API. So the UI owns the socket and relays commands
 * here, and this file executes them against the document.
 *
 * Wire protocol (both directions, JSON over the socket):
 *   out  { type: "register", pluginId, fileKey, fileName }
 *   in   { type: "command", id, command, params }
 *   out  { type: "commandResult", id, result, error }
 */

figma.showUI(__html__, { width: 320, height: 220 });

figma.ui.postMessage({
  type: "init",
  fileKey: figma.fileKey || figma.root.id,
  fileName: figma.root.name,
});

figma.ui.onmessage = async (msg) => {
  if (msg.type !== "command") return;

  try {
    const result = await runCommand(msg.command, msg.params || {});
    figma.ui.postMessage({ type: "commandResult", id: msg.id, result, error: null });
  } catch (err) {
    figma.ui.postMessage({
      type: "commandResult",
      id: msg.id,
      result: null,
      error: err && err.message ? err.message : String(err),
    });
  }
};

async function runCommand(command, params) {
  switch (command) {
    case "ping":
      return { ok: true, file: figma.root.name };
    case "getContext":
      return getContext(params);
    case "planPreview":
      return planPreview(params);
    case "applyOperations":
      return applyOperations(params);
    default:
      throw new Error(
        'Unknown command "' + command + '". tidy-core v0.2.0 supports: ' +
          "ping, getContext, planPreview, applyOperations."
      );
  }
}

/**
 * Resolve each target and count what depends on it.
 *
 * Two kinds of usage, counted separately because they break differently:
 *   aliasReferences  other variables pointing at this one. Cheap and exact.
 *   nodeBindings     layer properties bound to it. Needs a traversal.
 */
async function planPreview(params) {
  var refs = params.targets || [];
  var variables = await figma.variables.getLocalVariablesAsync();
  var collections = await figma.variables.getLocalVariableCollectionsAsync();

  var collectionName = {};
  collections.forEach(function (c) { collectionName[c.id] = c.name; });

  var byId = {};
  variables.forEach(function (v) { byId[v.id] = v; });

  var aliasCounts = countAliasReferences(variables);
  var bindingScan = null; // built lazily, only if something resolves

  var seen = {};
  var targets = [];

  for (var i = 0; i < refs.length; i++) {
    var ref = refs[i];
    if (seen[ref]) continue;
    seen[ref] = true;

    var matches = variables.filter(function (v) { return v.id === ref || v.name === ref; });

    if (matches.length === 0) {
      targets.push({ ref: ref, found: false, reason: "no variable with that name or id" });
      continue;
    }
    if (matches.length > 1) {
      targets.push({
        ref: ref,
        found: false,
        reason:
          matches.length + " variables share the name \"" + ref + "\" (in " +
          matches.map(function (m) { return collectionName[m.variableCollectionId] || "?"; }).join(", ") +
          "). Use the variable id instead.",
      });
      continue;
    }

    if (bindingScan === null) bindingScan = scanNodeBindings();

    var v = matches[0];
    targets.push({
      ref: ref,
      found: true,
      id: v.id,
      name: v.name,
      resolvedType: v.resolvedType,
      collection: collectionName[v.variableCollectionId] || null,
      description: v.description || "",
      aliasReferences: aliasCounts[v.id] || 0,
      nodeBindings: bindingScan.counts[v.id] || 0,
      bindingsExact: bindingScan.exact,
    });
  }

  return {
    file: { name: figma.root.name, key: figma.fileKey || null },
    targets: targets,
  };
}

/** Variables whose value in any mode is an alias to another variable. */
function countAliasReferences(variables) {
  var counts = {};
  variables.forEach(function (v) {
    var modes = Object.keys(v.valuesByMode);
    modes.forEach(function (mode) {
      var value = v.valuesByMode[mode];
      if (value && typeof value === "object" && value.type === "VARIABLE_ALIAS") {
        counts[value.id] = (counts[value.id] || 0) + 1;
      }
    });
  });
  return counts;
}

/**
 * Count layer properties bound to each variable.
 *
 * Capped, because a full traversal of a very large file will hang the plugin.
 * When the cap is hit the counts become a lower bound and `exact` goes false,
 * which the server turns into a visible risk rather than hiding it.
 */
var BINDING_SCAN_CAP = 50000;

function scanNodeBindings() {
  var counts = {};
  var visited = 0;
  var exact = true;

  var pages = figma.root.children;
  for (var p = 0; p < pages.length; p++) {
    var nodes = pages[p].findAllWithCriteria
      ? pages[p].findAllWithCriteria({ types: [
          "FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE", "RECTANGLE",
          "ELLIPSE", "POLYGON", "STAR", "VECTOR", "LINE", "TEXT", "GROUP", "SECTION",
        ] })
      : [];

    for (var n = 0; n < nodes.length; n++) {
      if (visited++ > BINDING_SCAN_CAP) { exact = false; break; }
      var bound = nodes[n].boundVariables;
      if (!bound) continue;

      var props = Object.keys(bound);
      for (var k = 0; k < props.length; k++) {
        var entry = bound[props[k]];
        if (!entry) continue;
        var list = Array.isArray(entry) ? entry : [entry];
        for (var e = 0; e < list.length; e++) {
          var alias = list[e];
          if (alias && alias.id) counts[alias.id] = (counts[alias.id] || 0) + 1;
        }
      }
    }
    if (!exact) break;
  }

  return { counts: counts, exact: exact };
}

/**
 * Execute the operations. Each one reports independently: one failure does not
 * roll back the others, and the server records exactly which succeeded.
 */
async function applyOperations(params) {
  var operations = params.operations || [];
  var results = [];

  for (var i = 0; i < operations.length; i++) {
    var op = operations[i];
    try {
      var variable = await resolveOne(op.target);

      if (op.type === "renameVariable") {
        var previous = variable.name;
        variable.name = op.newName;
        results.push({ ok: true, detail: 'Renamed "' + previous + '" to "' + op.newName + '"' });
      } else if (op.type === "setVariableDescription") {
        variable.description = op.description;
        results.push({ ok: true, detail: 'Set description on "' + variable.name + '"' });
      } else if (op.type === "deleteVariable") {
        var name = variable.name;
        variable.remove();
        results.push({ ok: true, detail: 'Deleted "' + name + '"' });
      } else {
        results.push({ ok: false, detail: 'Unknown operation type "' + op.type + '"' });
      }
    } catch (err) {
      results.push({ ok: false, detail: err && err.message ? err.message : String(err) });
    }
  }

  return { results: results };
}

async function resolveOne(ref) {
  var variables = await figma.variables.getLocalVariablesAsync();
  var matches = variables.filter(function (v) { return v.id === ref || v.name === ref; });
  if (matches.length === 0) throw new Error('No variable matches "' + ref + '"');
  if (matches.length > 1) throw new Error('"' + ref + '" is ambiguous; use the variable id');
  return matches[0];
}

async function getContext(params) {
  const include = params.include || ["tokens", "components", "rules"];
  const out = {
    file: { name: figma.root.name, key: figma.fileKey || null },
  };

  if (include.indexOf("tokens") !== -1 || include.indexOf("rules") !== -1) {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const variables = await figma.variables.getLocalVariablesAsync();

    const modesById = {};
    out.collections = collections.map((c) => {
      const modes = c.modes.map((m) => m.name);
      modesById[c.id] = { name: c.name, modes: modes };
      return { name: c.name, modes: modes, variableCount: c.variableIds.length };
    });

    out.variables = variables.map((v) => {
      const firstMode = Object.keys(v.valuesByMode)[0];
      const value = firstMode ? v.valuesByMode[firstMode] : null;
      const isAlias = !!(value && typeof value === "object" && value.type === "VARIABLE_ALIAS");
      const owner = modesById[v.variableCollectionId];
      return {
        name: v.name,
        type: v.resolvedType,
        collection: owner ? owner.name : "unknown",
        isAlias: isAlias,
      };
    });
  }

  if (include.indexOf("components") !== -1) {
    // Component sets first: a set is the meaningful unit, its variants are not.
    const sets = figma.root.findAllWithCriteria({ types: ["COMPONENT_SET"] });
    const setIds = {};
    const components = sets.map((s) => {
      setIds[s.id] = true;
      const properties = {};
      const defs = s.componentPropertyDefinitions || {};
      for (const key of Object.keys(defs)) {
        if (defs[key].type === "VARIANT") {
          properties[key.split("#")[0]] = defs[key].variantOptions || [];
        }
      }
      return { name: s.name, variantCount: s.children.length, properties: properties };
    });

    const standalone = figma.root
      .findAllWithCriteria({ types: ["COMPONENT"] })
      .filter((c) => !(c.parent && setIds[c.parent.id]))
      .map((c) => ({ name: c.name, variantCount: 1, properties: {} }));

    out.components = components.concat(standalone);
  }

  return out;
}
