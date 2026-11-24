export type HymnDocument = {
  id: string;
  category: string;
  title: string;
  number: string;
  relativePath: string;
  source: 'builtin' | 'custom';
  bookId?: string;
  hasAudio: boolean;
  authors?: string[];
  audioFileName?: string;
  lyricsReady: boolean;
};

export type CustomHymnBook = {
  id: string;
  name: string;
  createdAt: number;
};

export type HymnLibraryResult = {
  rootAvailable: boolean;
  documents: HymnDocument[];
  customBooks: CustomHymnBook[];
};

export type HymnImportResult = {
  canceled: boolean;
  imported: number;
  matched?: number;
  unmatched?: string[];
};

export type HymnPlayback = {
  id: string;
  title: string;
  album: string;
  artist: string;
  audioPath: string;
  duration: number;
  lyrics: string | null;
};

export type LyricsRecognitionRequest = {
  source: 'pdf' | 'audio';
  documentId?: string;
};

export type LyricsRecognitionResult = {
  canceled?: boolean;
  message?: string;
  text?: string;
  lrc?: string;
  timing?: 'recognized' | 'estimated' | 'none';
};
