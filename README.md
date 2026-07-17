# Product Graph Editor

A full-window React application for exploring and editing product capability graphs. The interface uses shadcn-style components and Cytoscape.js for interactive graph rendering.

## Run locally

```bash
./start_server.sh
```

The launcher installs dependencies when needed and forwards optional arguments to Vite. For example, `./start_server.sh --host 0.0.0.0` exposes the server on your local network.

Open the local URL printed by Vite. Use the left toolbar to add nodes, arrange the graph, fit it to the window, and zoom. Select any node to inspect its details in the right panel.

## Build

```bash
npm run build
```

## GitHub Pages

Pushes to `main` automatically build and publish the app through the **Deploy to GitHub Pages** workflow. The workflow can also be run manually from the repository's Actions tab.
