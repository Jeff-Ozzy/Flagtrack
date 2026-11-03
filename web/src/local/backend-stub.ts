/** Server-mode builds never call the offline backend; this keeps it out of the bundle. */
const unavailable = () => {
  throw new Error('Modo local indisponível nesta versão.');
};
export const localRequest = unavailable;
export const localPhoto = unavailable;
export const localReport = unavailable;
export const exportBackup = unavailable;
export const importBackup = unavailable;
export const resetAll = unavailable;
export const clockBehindMs = () => 0;
