export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        action="/api/login"
        method="post"
        className="w-full max-w-sm space-y-4 rounded-lg border border-black/10 p-6 dark:border-white/15"
      >
        <h1 className="text-lg font-semibold">Playground</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Enter the shared password to continue.
        </p>
        <input
          type="password"
          name="password"
          autoFocus
          required
          placeholder="Password"
          className="w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/20"
        />
        {error && (
          <p className="text-sm text-red-600" role="alert">
            Incorrect password.
          </p>
        )}
        <button
          type="submit"
          className="w-full rounded-md bg-foreground px-3 py-2 text-sm text-background"
        >
          Enter
        </button>
      </form>
    </main>
  );
}
