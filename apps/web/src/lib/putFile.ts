/** A file PUT to an address storage signed, saying how far it has got.
 *
 * An XHR, for the one thing `fetch` still cannot report in every browser: an upload's
 * progress. For a file large enough that the person needs to see it move — a Slack export
 * of a few hundred megabytes (ADR 0042) — and small enough that nothing else is needed.
 */
export function putFile(
  url: string,
  file: Blob,
  contentType: string,
  onProgress: (sent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', contentType);
    request.upload.onprogress = (event) => onProgress(event.loaded);
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error('The upload was refused. Choose the file again.'));
    request.onerror = () =>
      reject(new Error('The upload stopped. Check the connection and try again.'));
    request.send(file);
  });
}
