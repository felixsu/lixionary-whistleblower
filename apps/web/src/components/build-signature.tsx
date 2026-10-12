const version = process.env.NEXT_PUBLIC_APP_VERSION;
const revision = process.env.NEXT_PUBLIC_APP_REVISION;

export function BuildSignature() {
  return (
    <span
      className="build-signature"
      data-app-version={version}
      data-app-revision={revision}
      title={`Speak Up v${version} · ${revision === "local" ? "Local build" : `Build ${revision}`}`}
    >
      v{version}
    </span>
  );
}
