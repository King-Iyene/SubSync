// The dashboard that is embedded as an iframe inside the host platform.
// Placeholder until OAuth + SSO identity land (build steps 5 and 6).
export default function EmbeddedApp() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">SubSync</h1>
        <p className="text-muted-foreground">
          Your cross-account dashboard will appear here once your client
          accounts finish their first sync.
        </p>
      </div>
    </div>
  );
}
