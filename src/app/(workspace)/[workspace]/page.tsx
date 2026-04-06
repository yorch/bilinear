export default function WorkspacePage({
  params,
}: {
  params: { workspace: string };
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Welcome to {params.workspace}
        </h2>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Your workspace is ready. Issues and teams coming soon.
        </p>
      </div>
    </div>
  );
}
