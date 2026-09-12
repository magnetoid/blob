// @vitest-environment happy-dom
/** The lightbox: full size, closable three ways, and the original still reachable.
 *
 * The timeline shows the thumbnail; this is the only place the full bytes load, which is
 * the half of the thumbnail work that is visible rather than measurable.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Attachment } from '@blob/shared';

const { ImageLightbox } = await import('./ImageLightbox.tsx');

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'a1',
    filename: 'screenshot.png',
    mime: 'image/png',
    sizeBytes: 900_000,
    width: 1600,
    height: 900,
    url: 'https://files.example/api/files/ws/a1-screenshot.png',
    thumbUrl: 'https://files.example/api/files/ws/a1-screenshot.png.thumb.webp',
    ...overrides,
  } as Attachment;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the lightbox', () => {
  it('shows the original, not the thumbnail, at its own size', () => {
    const item = attachment();
    render(<ImageLightbox attachment={item} onClose={vi.fn()} />);

    const image = screen.getByAltText('screenshot.png') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe(item.url);
    expect(image.getAttribute('width')).toBe('1600');
    expect(image.getAttribute('height')).toBe('900');
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<ImageLightbox attachment={attachment()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on the backdrop', () => {
    const onClose = vi.fn();
    render(<ImageLightbox attachment={attachment()} onClose={onClose} />);
    // The host <dialog> is where a click on its backdrop lands.
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on the button', () => {
    const onClose = vi.fn();
    render(<ImageLightbox attachment={attachment()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when the picture itself is clicked', () => {
    const onClose = vi.fn();
    render(<ImageLightbox attachment={attachment()} onClose={onClose} />);

    fireEvent.click(screen.getByAltText('screenshot.png'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offers the original as a download, named as it was uploaded', () => {
    const item = attachment();
    render(<ImageLightbox attachment={item} onClose={vi.fn()} />);

    const link = screen.getByRole('link', { name: 'Download' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(item.url);
    expect(link.getAttribute('download')).toBe('screenshot.png');
  });

  it('is a dialog, named for the file it is showing', () => {
    render(<ImageLightbox attachment={attachment()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'screenshot.png' }) as HTMLDialogElement;
    // A native modal: open through showModal(), so everything behind it is inert.
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.open).toBe(true);
  });

  it('copes with a picture whose size nobody recorded', () => {
    render(
      <ImageLightbox
        attachment={attachment({ width: null, height: null })}
        onClose={vi.fn()}
      />,
    );
    const image = screen.getByAltText('screenshot.png');
    expect(image.hasAttribute('width')).toBe(false);
    expect(image.hasAttribute('height')).toBe(false);
  });
});
