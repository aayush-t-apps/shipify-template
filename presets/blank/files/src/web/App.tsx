import { AppShell, Card, EmptyState } from "./ui/primitives";

export function App() {
  return (
    <AppShell title="{{APP_NAME}}">
      <Card>
        <h1>{{APP_NAME}}</h1>
        <p className="muted">{{APP_DESCRIPTION}}</p>
      </Card>
      <EmptyState title="Nothing here yet">
        <p>Build the first screen in src/web/App.tsx.</p>
      </EmptyState>
    </AppShell>
  );
}
