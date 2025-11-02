# tabruh
A Firefox extension for managing browser tabs in a tree. It allows for manipulation of both open and closed tabs and windows.

# Features
- Vertical tabs panel with tree layout.
- Persistent state across browser sessions.
- An overview Page that allows for more convenient manupulation of tab trees across all open windows.
- Full session control using drag and drop.
  - Create and manage groups within trees for better organization.
  - Drag and drop windows, tabs, subtrees across closed/open windows, and the extension will make the necessary changes to browser state.
  - Drag and drop between sidebar and overview on any window in the current browser session.
- Snapshots
  - Create/Import/Export snapshots of your browser sessions.
  - Import tab setups from a [Sidebery](https://github.com/mbnuqw/sidebery) export file.
- Graceful handling of browser restored windows/tabs.

# Building the Extension

### Prerequisites
- [Bun](https://bun.sh/) is required to install dependencies and run the build scripts.
- you might also want to install [Node.js](https://nodejs.org/) if building the extension give you some errors.

### Build Steps
1. Clone the repository:
```sh
git clone https://github.com/thrombe/tabruh
cd tabruh/extension
```

2. Install the dependencies:
```sh
bun install
```

3. Build and package the extension:
```sh
bun run pkg-build
```
This command will build the extension source into the `./build` directory and then create a packaged `.zip` file in the `./build_artifacts/` directory.

# Tested Environment
The development and build setup for this extension has been tested and is confirmed to work with the following environment.
  - **Operating System**: Linux
  - **Node.js**: `v22.17.0`
  - **Bun**: `v1.2.18`
  - **Firefox**: `v138.0.4`

# Loading for Development
After building the source (you can use `bun run build`), you can load the extension for development or testing in Firefox:

### Automatic
```sh
bun run dev
```
The extension will now be loaded in a test profile saved under `./tmp`. Changes to the source code will require you to run the build script again using `bun run build` and will be loaded automatically.

### Manual
1.  Navigate to `about:debugging` in Firefox.
2.  Click on "This Firefox" in the sidebar.
3.  Click "Load Temporary Add-on...".
4.  Navigate to the project directory and select the `manifest.json` file inside the `./build` directory.

The extension will now be loaded. Changes to the source code will require you to run the build script again and reload the extension from the `about:debugging` page.

# Similar Extensions
If you are exploring options in this space, you may also want to check out the following projects:
  - [Sidebery](https://github.com/mbnuqw/sidebery)
  - [Tree Style Tab](https://github.com/piroor/treestyletab)
  - [Tabox](https://github.com/gilgold/tabox)

# Contributing
Contributions are welcome! If you're fixing a bug, adding a feature, or making an improvement, feel free to submit a pull request (PR) to help enhance the extension.

### Guidelines:
- Provide clear reproduction steps when fixing a bug. If you're resolving an issue, include detailed instructions on how to reproduce it so the fix can be verified.
- Test your changes to ensure everything works as expected.

If you have any questions or concerns about your contribution, don't hesitate to open an issue or ask for feedback.
