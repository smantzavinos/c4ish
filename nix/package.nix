{
  lib,
  stdenv,
  nodejs_22,
  pnpm,
  fetchPnpmDeps,
  pnpmConfigHook,
  makeWrapper,
  imagemagick,
}:

stdenv.mkDerivation (finalAttrs: {
  pname = "c4ish";
  version = (lib.importJSON ../package.json).version;

  # Everything tracked except the Nix files, so editing them does not rebuild the package.
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.difference ../. (
      lib.fileset.unions [
        ../flake.nix
        ../flake.lock
        ../nix
      ]
    );
  };

  # Update this hash after pnpm-lock.yaml changes (build once with lib.fakeHash to get it).
  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    fetcherVersion = 4;
    hash = "sha256-ia41YJaOxGpLkVYO61DIC/19EsUZc5ocTCRJ3uPTomw=";
  };

  nativeBuildInputs = [
    nodejs_22
    pnpm
    pnpmConfigHook
    makeWrapper
  ];

  # `pnpm build` writes the static viewer (build/) and the library and CLI (dist/).
  buildPhase = ''
    runHook preBuild
    pnpm build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    # Reinstall with only the runtime dependencies (pruning in place leaves the dev ones on disk).
    rm -r node_modules
    CI=true pnpm install --offline --prod --frozen-lockfile --ignore-scripts

    mkdir -p $out/lib/c4ish $out/bin
    cp -r package.json dist build schema node_modules $out/lib/c4ish/
    install -Dm644 docs/AUTHORING.md $out/lib/c4ish/docs/AUTHORING.md

    # ImageMagick is only used by --png; a `magick` already on PATH wins.
    makeWrapper ${lib.getExe nodejs_22} $out/bin/c4ish \
      --add-flags $out/lib/c4ish/dist/cli/main.js \
      --suffix PATH : ${lib.makeBinPath [ imagemagick ]}

    runHook postInstall
  '';

  # Run the installed CLI from outside the source tree.
  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    model=$PWD/examples/paged-reads/model.c4ish.json
    (cd "$TMPDIR" && $out/bin/c4ish validate "$model" && $out/bin/c4ish render "$model" --out "$TMPDIR/check.svg")
    test -s "$TMPDIR/check.svg"
    $out/bin/c4ish --version | grep -q "^c4ish ${finalAttrs.version} "
    $out/bin/c4ish guide | grep -q '"schemaVersion"'
    $out/bin/c4ish schema profile | grep -q profileVersion
    runHook postInstallCheck
  '';

  meta = {
    description = "Reviewable architecture diagrams of a planned software change";
    homepage = "https://github.com/smantzavinos/c4ish";
    license = lib.licenses.mit;
    mainProgram = "c4ish";
    platforms = lib.platforms.unix;
  };
})
