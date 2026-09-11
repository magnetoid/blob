# Meetup Functionality

Blob now supports multi-participant video and audio conferencing through integrated Meetups.

## Features

- **Instant Meetups**: Start a meeting directly from any channel.
- **Multi-participant**: Supports up to 100+ concurrent participants (SFU-based).
- **In-meeting Controls**:
  - Toggle Camera & Microphone.
  - Screen Sharing.
  - Participant List.
  - Chat.
- **Secure Access**: Meetups are protected by workspace-level authentication and unique join tokens.
- **Adaptive Quality**: Automatic bitrate adjustment based on network conditions.

## Technical Architecture

### Real-Time Communication
Meetups are powered by **LiveKit**, a high-performance, open-source Selective Forwarding Unit (SFU). This architecture allows for superior scaling compared to traditional P2P mesh networks, as each participant only needs to upload their stream once.

### Backend
- **Database**: A `meetups` table stores meeting metadata, creator information, and status.
- **Signaling**: Meetup lifecycle events are managed via the existing WebSocket hub.
- **Token Generation**: The backend uses the LiveKit Server SDK to mint short-lived JWT join tokens, ensuring only authorized workspace members can join.

### Frontend
- **LiveKit Client**: Manages WebRTC connections and media tracks.
- **React Components**: Built using `@livekit/components-react` for a professional, responsive UI.

## Setup

To enable Meetups in production, the following environment variables must be configured:

```env
LIVEKIT_URL=wss://your-livekit-server.com
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
```

## User Guide

### For Hosts
1. Navigate to any channel.
2. Click the **Meetup** button in the channel header.
3. You will be automatically joined to the meeting.
4. Share the URL with other members of the workspace.

### For Participants
1. Click a shared meetup link or the join button in a channel.
2. Grant camera and microphone permissions when prompted by the browser.
3. Use the control bar at the bottom to manage your media and screen sharing.
