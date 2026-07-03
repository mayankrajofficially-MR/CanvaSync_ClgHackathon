import { Board } from '../types';

export interface FuzzySearchResult {
  board: Board;
  score: number;
  matchType: 'title' | 'tag' | 'owner' | 'none';
  matchedTag?: string;
}

/**
 * Fuzzy matches a pattern against a target string.
 * Returns a score, higher means better match. Score of 0 means no match.
 */
export function fuzzyMatch(pattern: string, target: string): number {
  if (!pattern) return 1;
  const p = pattern.toLowerCase();
  const t = target.toLowerCase();

  if (p === t) return 100;
  if (t.includes(p)) {
    // Exact substring matching is highly ranked
    return 80 + (p.length / t.length) * 10;
  }

  // Character subsequence fuzzy matching (checking if chars of pattern exist in order within target)
  let pIdx = 0;
  let tIdx = 0;
  let score = 0;
  let consecutive = 0;

  while (tIdx < t.length && pIdx < p.length) {
    if (t[tIdx] === p[pIdx]) {
      pIdx++;
      score += 10;
      
      // Bonus for start of string
      if (tIdx === 0) score += 15;
      
      // Bonus for consecutive matches
      consecutive++;
      score += consecutive * 3;
      
      // Bonus for start of words (preceded by spaces, hyphens, or underscores)
      if (tIdx > 0 && (t[tIdx - 1] === ' ' || t[tIdx - 1] === '-' || t[tIdx - 1] === '_')) {
        score += 12;
      }
    } else {
      consecutive = 0;
    }
    tIdx++;
  }

  // If all characters of pattern were found in target in order
  if (pIdx === p.length) {
    return score;
  }

  return 0;
}

/**
 * Searches a list of boards by title or tags using fuzzy matching.
 * Returns the filtered list of boards sorted by matching score descending.
 */
export function searchBoards(boards: Board[], query: string): Board[] {
  const trimmed = query.trim();
  if (!trimmed) return boards;

  const results: FuzzySearchResult[] = [];

  for (const board of boards) {
    let maxScore = 0;
    let bestType: FuzzySearchResult['matchType'] = 'none';
    let matchedTag: string | undefined;

    // 1. Check title
    const titleScore = fuzzyMatch(trimmed, board.title);
    if (titleScore > maxScore) {
      maxScore = titleScore;
      bestType = 'title';
    }

    // 2. Check tags
    if (board.tags && board.tags.length > 0) {
      for (const tag of board.tags) {
        const tagScore = fuzzyMatch(trimmed, tag);
        if (tagScore > 0) {
          const adjustedTagScore = tagScore * 1.1; // 10% bonus for tag matches to make them snappy
          if (adjustedTagScore > maxScore) {
            maxScore = adjustedTagScore;
            bestType = 'tag';
            matchedTag = tag;
          }
        }
      }
    }

    // 3. Check owner (optional helper)
    const ownerScore = fuzzyMatch(trimmed, board.ownerName);
    if (ownerScore > 0) {
      const adjustedOwnerScore = ownerScore * 0.8; // Lower weight for owner matches
      if (adjustedOwnerScore > maxScore) {
        maxScore = adjustedOwnerScore;
        bestType = 'owner';
      }
    }

    if (maxScore > 0) {
      results.push({
        board,
        score: maxScore,
        matchType: bestType,
        matchedTag
      });
    }
  }

  // Sort by score descending
  return results
    .sort((a, b) => b.score - a.score)
    .map(r => r.board);
}
