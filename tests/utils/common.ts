export function uniqueNameToken(length: number = 8): string {
  return Array.from({ length }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26))
  ).join('');
}

export function uniqueEmailToken(): string {
  return `${Date.now().toString(36).slice(-6)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}