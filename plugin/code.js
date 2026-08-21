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
    default:
      throw new Error(
        'Unknown command "' + command + '". tidy-core v0.1.0 supports: ping, getContext.'
      );
  }
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
