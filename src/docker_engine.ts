import * as http from 'node:http';

export interface DockerContainerSummary {
  id: string;
  name: string;
  image: string;
  imageId: string;
  labels: Record<string, string>;
}

export interface DockerImageInspect {
  Id?: string;
  RepoTags?: string[] | null;
  Config?: { Labels?: Record<string, string> | null } | null;
}

export interface DockerContainerInspect {
  Id?: string;
  Name?: string;
  Config?: { Labels?: Record<string, string> | null } | null;
}

function getSocketPath(): string {
  return (process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock').trim();
}

function requestJson<T>(
  method: string,
  path: string,
): Promise<T> {
  const socketPath = getSocketPath();
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        method,
        path,
        headers: { Accept: 'application/json' },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(d as Buffer));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Docker API ${method} ${path} failed: ${res.statusCode} ${body}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as T);
          } catch (e) {
            reject(new Error(`Docker API ${method} ${path} invalid JSON: ${String(e)} body=${body.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

export async function dockerAvailable(): Promise<boolean> {
  try {
    // GET /_ping returns "OK"
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        { socketPath: getSocketPath(), method: 'GET', path: '/_ping' },
        (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`Docker API /_ping status ${res.statusCode}`));
            return;
          }
          resolve();
        },
      );
      req.on('error', reject);
      req.end();
    });
    return true;
  } catch {
    return false;
  }
}

export async function listRunningContainers(): Promise<DockerContainerSummary[]> {
  const data = await requestJson<Array<{
    Id: string;
    Names: string[];
    Image: string;
    ImageID: string;
    Labels?: Record<string, string>;
  }>>('GET', '/containers/json');

  return data.map((c) => ({
    id: c.Id,
    name: (c.Names?.[0] || c.Id).replace(/^\//, ''),
    image: c.Image,
    imageId: c.ImageID,
    labels: c.Labels || {},
  }));
}

export async function inspectImage(imageIdOrName: string): Promise<DockerImageInspect> {
  const encoded = encodeURIComponent(imageIdOrName);
  return requestJson<DockerImageInspect>('GET', `/images/${encoded}/json`);
}

export async function inspectContainer(containerId: string): Promise<DockerContainerInspect> {
  const encoded = encodeURIComponent(containerId);
  return requestJson<DockerContainerInspect>('GET', `/containers/${encoded}/json`);
}
