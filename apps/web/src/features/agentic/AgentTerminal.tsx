/** A terminal inside a hosted agent's container.
 *
 * The part of setting an agent up that a form cannot do. A device-code login prints a URL
 * and waits for an approval that happens somewhere else entirely; a broken virtualenv
 * needs looking at; a prompt file needs editing. On a laptop all of that is a shell, and
 * an agent Blob deployed had no equivalent — the console could redeploy it and read its
 * logs, which is the difference between an operator who can fix a thing and one who can
 * only turn it off and on again.
 *
 * xterm.js is **imported lazily**, on the first open. It is the largest dependency in this
 * app by some way, and most people never open a terminal — paying for it in the main
 * bundle would slow the workspace down to make the console possible.
 *
 * Output is written as it arrives rather than buffered: a terminal that appears in
 * complete lines is a log viewer, and the reason this exists is the flows that are
 * interactive.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  pluginId: string;
  agentName: string;
  onClose: () => void;
}

/** What the socket says, and what it is told. Mirrors `routers/agent_shell.py`. */
type Incoming =
  | { t: 'ready'; agent: string }
  | { t: 'out'; data: string }
  | { t: 'exit'; code: number | null }
  | { t: 'error'; message: string }
  | { t: 'pong' };

type Phase = 'connecting' | 'open' | 'closed' | 'failed';

export function AgentTerminal({ pluginId, agentName, onClose }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [phase, setPhase] = useState<Phase>('connecting');
  const [problem, setProblem] = useState<string | null>(null);

  // Held in a ref rather than state: every keystroke would otherwise re-render the
  // component that owns the terminal, and xterm writes to the DOM itself.
  const termRef = useRef<{ dispose: () => void } | null>(null);

  const stop = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    termRef.current?.dispose();
    termRef.current = null;
  }, []);

  useEffect(() => {
    let live = true;
    let cleanupResize: (() => void) | undefined;

    async function start() {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      await import('@xterm/xterm/css/xterm.css');
      if (!live || !mountRef.current) return;

      const term = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontSize: 12,
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        // Matched to the app rather than xterm's default black, so the panel reads as part
        // of the console instead of a window pasted into it.
        theme: { background: '#11141a', foreground: '#d7dbe3', cursor: '#d7dbe3' },
        // A terminal that cannot scroll back is a terminal you cannot read the error in.
        scrollback: 5000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(mountRef.current);
      fit.fit();
      termRef.current = term;

      const url = new URL(
        `/ws/admin/agents/${pluginId}/shell`,
        window.location.origin.replace(/^http/, 'ws'),
      );
      url.searchParams.set('cols', String(term.cols));
      url.searchParams.set('rows', String(term.rows));
      const socket = new WebSocket(url);
      socketRef.current = socket;

      const send = (frame: Record<string, unknown>) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
      };

      socket.onmessage = (event) => {
        let frame: Incoming;
        try {
          frame = JSON.parse(String(event.data)) as Incoming;
        } catch {
          return;
        }
        if (frame.t === 'ready') setPhase('open');
        else if (frame.t === 'out') term.write(frame.data);
        else if (frame.t === 'error') {
          setProblem(frame.message);
          setPhase('failed');
        } else if (frame.t === 'exit') {
          setPhase('closed');
          term.write('\r\n\x1b[2m— the shell ended —\x1b[0m\r\n');
        }
      };

      // A close before `ready` is a refusal — the server rejects before upgrading so it
      // can say why. The browser does not surface the reason on a failed upgrade, so this
      // says the useful thing rather than reporting a code nobody can act on.
      socket.onclose = () => {
        setPhase((current) => (current === 'connecting' ? 'failed' : 'closed'));
        setProblem((current) =>
          current ??
          'The terminal was refused. This agent may not be one Blob deployed, or the ' +
            'server may not be set up to open one.',
        );
      };

      term.onData((data) => send({ t: 'in', data }));

      // The far end sizes its output to what it was told the window is, so a resize that
      // is not forwarded leaves every prompt wrapping in the wrong place.
      const onResize = () => {
        fit.fit();
        send({ t: 'resize', cols: term.cols, rows: term.rows });
      };
      window.addEventListener('resize', onResize);
      cleanupResize = () => window.removeEventListener('resize', onResize);

      term.focus();
    }

    void start();
    return () => {
      live = false;
      cleanupResize?.();
      stop();
    };
  }, [pluginId, stop]);

  return (
    <div className="agent-terminal">
      <div className="agent-terminal-bar">
        <span className="admin-row-title">Terminal — {agentName}</span>
        <span className="role-pill" data-muted={phase !== 'open'}>
          {phase === 'connecting' ? 'connecting…' : phase}
        </span>
        <div className="topbar-spacer" />
        <button className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>

      {problem && <div className="admin-row-meta agent-terminal-problem">{problem}</div>}

      <div className="agent-terminal-screen" ref={mountRef} />

      <p className="pref-hint" style={{ margin: '8px 0 0' }}>
        You are root inside the agent's container, and nowhere else. The session is
        recorded in the audit log and closes on its own once it has been idle for a while.
      </p>
    </div>
  );
}
