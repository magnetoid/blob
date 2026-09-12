import {
  LiveKitRoom,
  VideoConference,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { navigate } from '../../lib/router';
import { EmptyState } from '../../components/EmptyState.tsx';

export function MeetupView({ meetupId }: { meetupId: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.meetups.getToken(meetupId)
      .then((res) => {
        setToken(res.token);
        setUrl(res.url);
      })
      .catch((err) => {
        setError(err.message);
      });
  }, [meetupId]);

  if (error) {
    return (
      <main className="pane">
        <EmptyState
          title="Could not join meetup"
          action={
            <button className="btn" onClick={() => navigate('/')}>
              Back to Home
            </button>
          }
        >
          {error}
        </EmptyState>
      </main>
    );
  }

  if (!token || !url) {
    return (
      <main className="pane">
        <EmptyState title="Connecting to meetup…">Setting up secure connection</EmptyState>
      </main>
    );
  }

  return (
    <main className="pane meetup-pane" style={{ padding: 0, position: 'relative' }}>
      <LiveKitRoom
        video={true}
        audio={true}
        token={token}
        serverUrl={url}
        onDisconnected={() => navigate('/')}
        data-lk-theme="default"
        style={{ height: '100%' }}
      >
        <VideoConference />
      </LiveKitRoom>
    </main>
  );
}
