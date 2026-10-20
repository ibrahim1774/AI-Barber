/** Jest stand-in for native modules the unit under test never calls. */
export default {};
export const getDocumentAsync = async () => ({ canceled: true, assets: [] });
