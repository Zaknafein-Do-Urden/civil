// Encyclopedia (百科) entries. Each topic file in this folder exports `entries: WikiEntry[]`;
// index.ts collects every file automatically, so adding a topic never touches a shared file.

export interface WikiEntry {
  id: string;
  /** Category shown as a group heading, e.g. '地图', '经济', '政治', '外交与战争'. */
  category: string;
  title: string;
  /** HTML body. Explain the mechanism, what the player sees, and which parameters tune it. */
  body: string;
}
