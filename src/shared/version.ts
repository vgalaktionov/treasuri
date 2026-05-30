export const appName = "treasuri";

export function describeRuntime(nodeVersion = process.versions.node): string {
  return `${appName} node/${nodeVersion}`;
}
