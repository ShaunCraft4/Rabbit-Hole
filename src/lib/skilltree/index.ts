/**
 * Skill-tree backend (Engine-owned): layout, node pages and labels. Pure and client-safe.
 *
 *   const tree = useMemo(() => buildSkillTree(investigation, { showGaps }), [investigation, showGaps]);
 *   const page = selectedId ? buildNodePage(investigation, tree, selectedId) : null;
 */
export { buildSkillTree, doorNodeId, findingNodeId, gapNodeId, SKILL_TREE, START_NODE_ID } from "./layout";
export { buildNodePage, EVIDENCE_NOTES, GAP_KIND_NOTES } from "./page";
export { cleanLabel, fallbackLabel, LABEL, wrapLabel } from "./labels";
export * from "./types";
