// Roll out only after the additive server migration and worker are active.
export const webDraftsEnabled = () => process.env.EXPO_PUBLIC_WEB_DRAFTS === '1';
