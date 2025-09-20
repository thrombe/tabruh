{
  description = "yaaaaaaaaaaaaaaaaaaaaa";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";

    zig-overlay = {
      url = "github:mitchellh/zig-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-utils.follows = "flake-utils";
    };
    zls = {
      url = "github:zigtools/zls/0.14.0";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.zig-overlay.follows = "zig-overlay";
    };

    zig2nix = {
      url = "github:Cloudef/zig2nix";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-utils.follows = "flake-utils";
    };
  };

  outputs = inputs:
    inputs.flake-utils.lib.eachDefaultSystem (system: let
      flakePackage = flake: package: flake.packages."${system}"."${package}";
      flakeDefaultPackage = flake: flakePackage flake "default";

      overlays = [
        (self: super: rec {
          # zig = inputs.zig2nix.outputs.packages.${system}.zig-latest;
          # zls = (flakePackage inputs.zls "zls").overrideAttrs (old: {
          #   nativeBuildInputs = [ zig ];
          #   buildInputs = [ zig ];
          # });
        })
      ];

      pkgs = import inputs.nixpkgs {
        config.allowUnfree = true;
        inherit system;
        inherit overlays;
      };

      jjazy = stdenv.mkDerivation {
        name = "jjazy";
        src = pkgs.lib.cleanSource ./.;

        nativeBuildInputs = with pkgs; [
          zig
          zig.hook
        ];
        buildInputs = with pkgs; [
          jujutsu
        ];

        buildPhase = ''
          zig build -Doptimize=ReleaseSafe -Denv=prod
        '';
        installPhase = ''
          mkdir -p $out/bin
          cp ./zig-out/bin/jjazy $out/bin/.
        '';
      };

      fhs = pkgs.buildFHSEnv {
        name = "fhs-shell";
        targetPkgs = p: (env-packages p) ++ (custom-commands p);
        runScript = "${pkgs.zsh}/bin/zsh";
        profile = ''
          export FHS=1
          # source ./.venv/bin/activate
          # source .env
        '';
      };
      custom-commands = pkgs: [
        (pkgs.writeShellScriptBin "todo" ''
          #!/usr/bin/env bash
          cd $PROJECT_ROOT
        '')
      ];

      env-packages = pkgs:
        (with pkgs; [
          pkg-config

          zig

          zls
          gdb

          ghostty
          kitty
        ])
        ++ []
        ++ (custom-commands pkgs);

      stdenv = pkgs.clangStdenv;
    in {
      packages = {
        inherit jjazy;
        default = jjazy;
      };
      overlays = {};

      devShells.default =
        pkgs.mkShell.override {
          inherit stdenv;
        } {
          nativeBuildInputs = (env-packages pkgs) ++ [fhs];
          inputsFrom = [];
          shellHook = ''
            export PROJECT_ROOT="$(pwd)"
            export CLANGD_FLAGS="--compile-commands-dir=$PROJECT_ROOT --query-driver=$(which $CXX)"
          '';
        };
    });
}
