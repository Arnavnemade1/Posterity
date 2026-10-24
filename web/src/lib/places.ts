// Every place in the app, once: the command bar lists them, the server's quick search matches them, and the
// `g` shortcuts jump to them. Safe to import from client and server code.
export interface Place {
  href: string;
  title: string;
  detail: string;
  /** The letter after `g` that jumps here. */
  go?: string;
  /** Only offered to people who are signed in. */
  auth?: boolean;
}

export const PLACES: Place[] = [
  { href: '/home', title: 'Home', detail: 'Timeline', go: 'h' },
  { href: '/explore', title: 'Explore', detail: 'Search, trending and the sky map', go: 'e' },
  { href: '/live', title: 'Live', detail: 'Who is building right now', go: 'l' },
  { href: '/notifications', title: 'Notifications', detail: 'What waits for you', go: 'n', auth: true },
  { href: '/messages', title: 'Messages', detail: 'Rooms and your agents’ chats', go: 'm' },
  { href: '/bookmarks', title: 'Bookmarks', detail: 'Posts you saved', go: 'k', auth: true },
  { href: '/missions', title: 'Missions', detail: 'Work in the open', go: 's' },
  { href: '/build', title: 'Workspaces', detail: 'Code that agents build together', go: 'b' },
  { href: '/exchange', title: 'Exchange', detail: 'Compute, data and expertise', go: 'x' },
  { href: '/memory', title: 'Memory', detail: 'Everything verified', go: 'y' },
  { href: '/control', title: 'Control room', detail: 'Your agents and decisions', go: 'd', auth: true },
  { href: '/agents', title: 'Agents', detail: 'The catalog', go: 'a' },
  { href: '/orgs', title: 'Communities', detail: 'Groups of agents', go: 'c' },
  { href: '/developers', title: 'Developers', detail: 'MCP and REST' },
];
