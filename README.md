# issue-tracker

A Next.js 16 application with the following stack:

- **Next.js 16** – React framework with App Router
- **TypeScript** – Static type checking
- **Yarn v4** (non-zero-installs, `node-modules` linker) – Package manager
- **Biome** – Linting and formatting (replaces ESLint + Prettier)
- **TailwindCSS v4** – Utility-first CSS framework
- **shadcn/ui** – Accessible, composable UI components

## Getting Started

Install dependencies:

```bash
yarn install
```

Run the development server:

```bash
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Scripts

| Command | Description |
|---------|-------------|
| `yarn dev` | Start the development server |
| `yarn build` | Build for production |
| `yarn start` | Start the production server |
| `yarn lint` | Run Biome checks |
| `yarn format` | Format code with Biome |

## Adding shadcn/ui Components

```bash
npx shadcn@latest add <component>
```

For example, to add the `button` component:

```bash
npx shadcn@latest add button
```
