/** Recover the target from our release filenames, including old manifests
 * which incorrectly labelled darwin archives as Windows.
 */
export function artifactTarget(file: string) {
  const match = file.match(/-(darwin|win32|win|linux)-(arm64|x64)\.(?:zip|tar\.gz|dmg|exe)$/i);
  if (!match) return null;
  const name = match[1]!.toLowerCase();
  return {
    platform: (name === "win32" ? "win" : name) as "darwin" | "win" | "linux",
    arch: match[2]!.toLowerCase(),
  };
}

export function selectArtifact<T extends { file: string; platform: string }>(
  artifacts: T[],
  platform: string,
  arch?: string | null,
): T | null {
  return (
    artifacts.find((artifact) => {
      const target = artifactTarget(artifact.file);
      return (
        (target?.platform ?? artifact.platform) === platform && (!arch || target?.arch === arch)
      );
    }) ?? null
  );
}
