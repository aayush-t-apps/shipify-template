import type { ButtonHTMLAttributes, ReactNode } from "react";

export function AppShell(props: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="shell">
      <header className="shell-header">
        <span className="shell-title">{props.title}</span>
        {props.actions}
      </header>
      <main className="shell-main">{props.children}</main>
    </div>
  );
}

export function Button({
  variant = "default",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" }) {
  return (
    <button
      type="button"
      className={`btn ${variant === "primary" ? "btn-primary" : ""} ${className}`}
      {...rest}
    />
  );
}

export function Card(props: { title?: string; children: ReactNode }) {
  return (
    <section className="card">
      {props.title && <h2>{props.title}</h2>}
      {props.children}
    </section>
  );
}

export function Alert(props: { tone?: "error" | "info"; children: ReactNode }) {
  const tone = props.tone ?? "info";
  return (
    <div className={`alert alert-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {props.children}
    </div>
  );
}

export function EmptyState(props: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{props.title}</h2>
      {props.children}
    </div>
  );
}
