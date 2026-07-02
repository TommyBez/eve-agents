import type { LucideIcon } from "lucide-react";
import {
  AlertTriangleIcon,
  BrainIcon,
  CalendarClockIcon,
  PlugZapIcon,
  RadioTowerIcon,
  ScrollTextIcon,
  SparklesIcon,
  WrenchIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  ContextWindowMeter,
  CopyButton,
  ToolsTable,
} from "@/app/_components/diagnostics-client";
import type { AgentEntry } from "@/lib/agents";
import { diagnosticCount, fetchAgentInfo } from "@/lib/info";

/**
 * Server component: fetches `/eve/v1/info` with the proxy's server-held
 * credentials and renders the agent's introspection payload.
 */
export async function DiagnosticsPanel({
  agent,
}: {
  readonly agent: AgentEntry;
}) {
  const result = await fetchAgentInfo(agent);

  if (!result.ok) {
    if (result.kind === "unauthorized") {
      return (
        <ErrorCallout title="The agent rejected the playground's credentials">
          <p>
            <code className="font-mono">/eve/v1/info</code> is auth-gated by the
            agent's eve channel and it answered with a 401/403 ({result.detail}
            ).
          </p>
          {agent.target.kind === "url" ? (
            <p>
              Set{" "}
              <code className="font-mono">
                {agent.target.authHeaderEnv ??
                  `PLAYGROUND_${agent.id.toUpperCase().replaceAll("-", "_")}_AUTH`}
              </code>{" "}
              to a full Authorization header value the agent accepts
              {agent.target.authHeaderEnv
                ? " (it is currently unset or wrong)"
                : ` and reference it from "target.authHeaderEnv" for "${agent.id}" in agents.config.json`}
              .
            </p>
          ) : (
            <p>
              This is a local target — its{" "}
              <code className="font-mono">eve dev</code> server normally admits
              localhost via <code className="font-mono">localDev()</code>. Check
              the agent's{" "}
              <code className="font-mono">agent/channels/eve.ts</code> auth
              stack.
            </p>
          )}
        </ErrorCallout>
      );
    }
    if (result.kind === "unreachable") {
      return <UnreachableCallout agent={agent} detail={result.detail} />;
    }
    return (
      <ErrorCallout title="Could not load diagnostics">
        <p>{result.detail}</p>
      </ErrorCallout>
    );
  }

  const { info } = result;
  const model = info.agent?.model;
  const tools = info.tools?.available ?? [];
  const skills = info.skills?.static ?? [];
  const schedules = info.schedules ?? [];
  const connections = info.connections ?? [];
  // `available` is the union of authored + framework routes (and older eve
  // versions may omit it), so merge everything and dedupe by route identity.
  const channelMap = new Map(
    [
      ...(info.channels?.authored ?? []),
      ...(info.channels?.framework ?? []),
      ...(info.channels?.available ?? []),
    ].map((channel) => [
      `${channel.origin}:${channel.method}:${channel.urlPath}`,
      channel,
    ]),
  );
  const channels = [...channelMap.values()];
  const errorCount = diagnosticCount(info.diagnostics?.discoveryErrors);
  const warningCount = diagnosticCount(info.diagnostics?.discoveryWarnings);
  const instructions = info.instructions?.static?.markdown;

  return (
    <div className="flex flex-col gap-3 pb-8">
      {errorCount > 0 || warningCount > 0 ? (
        <div
          className={
            errorCount > 0
              ? "rounded-lg border border-danger/40 bg-danger/5 px-4 py-3"
              : "rounded-lg border border-warn/40 bg-warn/5 px-4 py-3"
          }
        >
          <p
            className={
              errorCount > 0
                ? "flex items-center gap-2 font-medium text-danger text-sm"
                : "flex items-center gap-2 font-medium text-sm text-warn"
            }
          >
            <AlertTriangleIcon className="size-4" />
            Discovery problems
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            {errorCount} discovery error{errorCount === 1 ? "" : "s"},{" "}
            {warningCount} warning{warningCount === 1 ? "" : "s"} reported by
            eve. Run <code className="font-mono">eve info</code> in the agent's
            app for details.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel
          className="lg:col-span-2"
          icon={BrainIcon}
          testId="diagnostics-model"
          title="Model"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Fact label="Id" mono value={model?.id ?? "unknown"} />
            <Fact
              label="Routing"
              mono
              value={
                model?.routing
                  ? `${model.routing.kind ?? "?"} → ${model.routing.target ?? model.routing.provider ?? "?"}`
                  : "unknown"
              }
            />
            {info.mode ? <Fact label="Mode" mono value={info.mode} /> : null}
          </div>
          <div className="mt-4 border-t pt-3">
            <p className="mb-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
              Context window
            </p>
            <ContextWindowMeter windowTokens={model?.contextWindowTokens} />
          </div>
        </Panel>

        <Panel
          className="lg:col-span-2"
          count={tools.length}
          icon={WrenchIcon}
          testId="diagnostics-tools"
          title="Tools"
        >
          {tools.length === 0 ? (
            <Empty>No tools available.</Empty>
          ) : (
            <ToolsTable
              tools={tools.map((tool) => ({
                description: tool.description,
                name: tool.name,
                origin: tool.origin,
                requiresApproval: tool.requiresApproval,
              }))}
            />
          )}
        </Panel>

        <Panel count={skills.length} icon={SparklesIcon} title="Skills">
          {skills.length === 0 ? (
            <Empty>No static skills.</Empty>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {skills.map((skill) => (
                <li key={skill.logicalPath}>
                  <p className="font-mono text-xs">{skill.logicalPath}</p>
                  {skill.description ? (
                    <p className="mt-0.5 text-muted-foreground text-xs">
                      {skill.description}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel count={channels.length} icon={RadioTowerIcon} title="Channels">
          {channels.length === 0 ? (
            <Empty>No channels.</Empty>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {channels.map((channel) => (
                <li
                  className="flex items-center gap-2 font-mono text-xs"
                  key={`${channel.origin}:${channel.method}:${channel.urlPath}`}
                >
                  <span className="w-12 shrink-0 rounded border bg-muted/60 px-1 py-px text-center text-[10px] text-muted-foreground">
                    {channel.method ?? "?"}
                  </span>
                  <span className="truncate">{channel.urlPath}</span>
                  <span className="ml-auto truncate pl-2 text-muted-foreground">
                    {channel.name ?? channel.origin}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          count={schedules.length}
          icon={CalendarClockIcon}
          title="Schedules"
        >
          {schedules.length === 0 ? (
            <Empty>No schedules.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {schedules.map((schedule) => (
                <li
                  className="flex items-center gap-2 text-xs"
                  key={schedule.logicalPath}
                >
                  <span className="font-mono">{schedule.logicalPath}</span>
                  {schedule.cron ? (
                    <span className="rounded border bg-muted/60 px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                      {schedule.cron}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          count={connections.length}
          icon={PlugZapIcon}
          title="Connections"
        >
          {connections.length === 0 ? (
            <Empty>No connections.</Empty>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {connections.map((connection, index) => (
                <li
                  className="font-mono text-xs"
                  key={connection.name ?? `connection-${index}`}
                >
                  {connection.name ?? "unnamed"}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          className="lg:col-span-2"
          icon={ScrollTextIcon}
          title="Instructions"
        >
          {instructions ? (
            <div className="relative rounded-md border bg-background">
              <div className="flex items-center justify-between border-b px-3 py-1.5">
                <span className="font-mono text-[11px] text-muted-foreground">
                  static system prompt ·{" "}
                  {instructions.length.toLocaleString("en-US")} chars
                </span>
                <CopyButton label="Copy instructions" text={instructions} />
              </div>
              <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap p-3 font-mono text-xs leading-5">
                {instructions}
              </pre>
            </div>
          ) : (
            <Empty>No static instructions reported.</Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Building blocks                                                    */
/* ------------------------------------------------------------------ */

function Panel({
  children,
  className,
  count,
  icon: Icon,
  testId,
  title,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly count?: number;
  readonly icon: LucideIcon;
  readonly testId?: string;
  readonly title: string;
}) {
  return (
    <section
      className={`rounded-lg border bg-card ${className ?? ""}`}
      data-testid={testId}
    >
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <Icon className="size-3.5 text-muted-foreground" />
        <h2 className="font-medium text-sm">{title}</h2>
        {count !== undefined ? (
          <span className="rounded bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground tabular-nums">
            {count}
          </span>
        ) : null}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function Fact({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div>
      <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
        {label}
      </p>
      <p className={`mt-1 text-sm ${mono ? "font-mono text-[13px]" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function Empty({ children }: { readonly children: ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}

function ErrorCallout({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-danger/40 bg-danger/5 p-4">
      <p className="flex items-center gap-2 font-medium text-danger text-sm">
        <AlertTriangleIcon className="size-4" />
        {title}
      </p>
      <div className="mt-2 flex flex-col gap-2 text-muted-foreground text-sm">
        {children}
      </div>
    </div>
  );
}

function UnreachableCallout({
  agent,
  detail,
}: {
  readonly agent: AgentEntry;
  readonly detail: string;
}) {
  const isLocal = agent.target.kind === "local";
  return (
    <ErrorCallout title="Agent unreachable">
      <p>{detail}</p>
      {isLocal && agent.target.kind === "local" ? (
        <>
          <p>
            Is <code className="font-mono">{agent.id}</code> running on port{" "}
            <code className="font-mono">{agent.target.port}</code>? Start every
            registered agent (plus this UI) with:
          </p>
          <div className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2">
            <code className="font-mono text-foreground text-xs">
              pnpm playground:dev
            </code>
            <CopyButton label="Copy command" text="pnpm playground:dev" />
          </div>
        </>
      ) : (
        <p>Check that the remote URL is correct and the deployment is up.</p>
      )}
    </ErrorCallout>
  );
}
