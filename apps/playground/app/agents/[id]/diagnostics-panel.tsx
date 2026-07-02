import {
  AlertTriangleIcon,
  BrainIcon,
  CalendarClockIcon,
  KeyRoundIcon,
  PlugZapIcon,
  RadioTowerIcon,
  ScrollTextIcon,
  SparklesIcon,
  WrenchIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
        <ErrorCard title="The agent rejected the playground's credentials">
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
        </ErrorCard>
      );
    }
    return (
      <ErrorCard
        title={
          result.kind === "unreachable"
            ? "Agent unreachable"
            : "Could not load diagnostics"
        }
      >
        <p>{result.detail}</p>
      </ErrorCard>
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
    <div className="flex flex-col gap-4 pb-8">
      {errorCount > 0 || warningCount > 0 ? (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangleIcon className="size-4 text-amber-600 dark:text-amber-300" />
              Discovery problems
            </CardTitle>
            <CardDescription>
              {errorCount} discovery error{errorCount === 1 ? "" : "s"},{" "}
              {warningCount} warning{warningCount === 1 ? "" : "s"} reported by
              eve. Run <code className="font-mono">eve info</code> in the
              agent's app for details.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card data-testid="diagnostics-model">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainIcon className="size-4 text-muted-foreground" />
            Model
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Fact label="Id" value={model?.id ?? "unknown"} mono />
          <Fact
            label="Context window"
            value={
              model?.contextWindowTokens
                ? `${model.contextWindowTokens.toLocaleString("en-US")} tokens`
                : "unknown"
            }
          />
          <Fact
            label="Routing"
            value={
              model?.routing
                ? `${model.routing.kind ?? "?"} → ${model.routing.target ?? model.routing.provider ?? "?"}`
                : "unknown"
            }
            mono
          />
        </CardContent>
      </Card>

      <Card data-testid="diagnostics-tools">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <WrenchIcon className="size-4 text-muted-foreground" />
            Tools
            <Badge variant="secondary">{tools.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tools.length === 0 ? (
            <Empty>No tools available.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Origin</TableHead>
                  <TableHead>Approval</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tools.map((tool) => (
                  <TableRow key={tool.name}>
                    <TableCell className="font-mono text-xs">
                      {tool.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {tool.origin ?? "unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {tool.requiresApproval ? (
                        <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                          required
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          none
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-md text-muted-foreground text-xs">
                      {tool.description}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <SparklesIcon className="size-4 text-muted-foreground" />
              Skills
              <Badge variant="secondary">{skills.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {skills.length === 0 ? (
              <Empty>No static skills.</Empty>
            ) : (
              <ul className="flex flex-col gap-3">
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTowerIcon className="size-4 text-muted-foreground" />
              Channels
              <Badge variant="secondary">{channels.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {channels.length === 0 ? (
              <Empty>No channels.</Empty>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {channels.map((channel) => (
                  <li
                    className="flex items-center gap-2 font-mono text-xs"
                    key={`${channel.origin}:${channel.method}:${channel.urlPath}`}
                  >
                    <Badge className="w-12 justify-center" variant="outline">
                      {channel.method ?? "?"}
                    </Badge>
                    <span className="truncate">{channel.urlPath}</span>
                    <span className="ml-auto text-muted-foreground">
                      {channel.name ?? channel.origin}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClockIcon className="size-4 text-muted-foreground" />
              Schedules
              <Badge variant="secondary">{schedules.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {schedules.length === 0 ? (
              <Empty>No schedules.</Empty>
            ) : (
              <ul className="flex flex-col gap-2">
                {schedules.map((schedule) => (
                  <li className="text-xs" key={schedule.logicalPath}>
                    <span className="font-mono">{schedule.logicalPath}</span>
                    {schedule.cron ? (
                      <Badge className="ml-2 font-mono" variant="outline">
                        {schedule.cron}
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PlugZapIcon className="size-4 text-muted-foreground" />
              Connections
              <Badge variant="secondary">{connections.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollTextIcon className="size-4 text-muted-foreground" />
            Instructions
          </CardTitle>
          <CardDescription>
            The agent's always-on system prompt (static sources).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {instructions ? (
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-2 text-muted-foreground text-sm hover:text-foreground">
                <KeyRoundIcon className="size-3.5" />
                Show full instructions (
                {instructions.length.toLocaleString("en-US")} chars)
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-3 max-h-[32rem] overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">
                  {instructions}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          ) : (
            <Empty>No static instructions reported.</Empty>
          )}
        </CardContent>
      </Card>
    </div>
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
      <p className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </p>
      <p className={`mt-1 text-sm ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function Empty({ children }: { readonly children: ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}

function ErrorCard({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangleIcon className="size-4 text-destructive" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-muted-foreground text-sm">
        {children}
      </CardContent>
    </Card>
  );
}
