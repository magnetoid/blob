-- Link previews live beside the message rather than inside its body, so editing a
-- message can never forge a preview and re-rendering never re-fetches.
ALTER TABLE messages ADD COLUMN link_preview jsonb;
