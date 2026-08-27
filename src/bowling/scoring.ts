// Klassisk 10-frame bowling-scoring med strikes, spares og 10. frames bonuskast.

export interface FrameState {
  rolls: number[]; // væltede kegler pr. kast i denne frame
}

export class BowlingScorecard {
  frames: FrameState[] = Array.from({ length: 10 }, () => ({ rolls: [] }));

  /** Frame-indeks (0-9) for næste kast, eller -1 hvis spillet er slut. */
  get currentFrame(): number {
    for (let i = 0; i < 10; i++) {
      if (!this.isFrameDone(i)) return i;
    }
    return -1;
  }

  get isDone(): boolean {
    return this.currentFrame === -1;
  }

  /** Antal kegler der står inden næste kast (10 = fuldt sæt). */
  pinsStandingForNextRoll(): number {
    const f = this.currentFrame;
    if (f === -1) return 0;
    const rolls = this.frames[f].rolls;
    if (f < 9) {
      return rolls.length === 0 ? 10 : 10 - rolls[0];
    }
    // 10. frame: nyt fuldt sæt efter strike/spare
    if (rolls.length === 0) return 10;
    if (rolls.length === 1) return rolls[0] === 10 ? 10 : 10 - rolls[0];
    // tredje kast
    if (rolls[0] === 10) {
      return rolls[1] === 10 ? 10 : 10 - rolls[1];
    }
    return 10; // spare i de to første -> fuldt sæt
  }

  isFrameDone(i: number): boolean {
    const rolls = this.frames[i].rolls;
    if (i < 9) {
      return rolls[0] === 10 || rolls.length >= 2;
    }
    // 10. frame
    if (rolls.length < 2) return false;
    const gotBonus = rolls[0] === 10 || rolls[0] + rolls[1] === 10;
    return gotBonus ? rolls.length >= 3 : rolls.length >= 2;
  }

  addRoll(pins: number) {
    const f = this.currentFrame;
    if (f === -1) return;
    this.frames[f].rolls.push(pins);
  }

  /** Kumulativ score pr. frame; null hvis den ikke kan afgøres endnu. */
  frameScores(): (number | null)[] {
    const allRolls: number[] = [];
    const frameStartIdx: number[] = [];
    for (let i = 0; i < 10; i++) {
      frameStartIdx.push(allRolls.length);
      allRolls.push(...this.frames[i].rolls);
    }

    const result: (number | null)[] = [];
    let cum = 0;
    for (let i = 0; i < 10; i++) {
      const start = frameStartIdx[i];
      const rolls = this.frames[i].rolls;
      let frameScore: number | null = null;

      if (i < 9) {
        if (rolls[0] === 10) {
          // strike: 10 + næste to kast
          const b1 = allRolls[start + 1];
          const b2 = allRolls[start + 2];
          if (b1 !== undefined && b2 !== undefined) frameScore = 10 + b1 + b2;
        } else if (rolls.length >= 2) {
          const sum = rolls[0] + rolls[1];
          if (sum === 10) {
            const b1 = allRolls[start + 2];
            if (b1 !== undefined) frameScore = 10 + b1;
          } else {
            frameScore = sum;
          }
        }
      } else if (this.isFrameDone(9)) {
        frameScore = rolls.reduce((x, y) => x + y, 0);
      }

      if (frameScore === null) {
        result.push(null);
      } else {
        cum += frameScore;
        result.push(cum);
      }
    }
    return result;
  }

  total(): number {
    const scores = this.frameScores();
    for (let i = 9; i >= 0; i--) {
      if (scores[i] !== null) return scores[i]!;
    }
    return 0;
  }

  /** Visning af kast: "X" for strike, "/" for spare, "-" for 0. */
  rollDisplay(frame: number): string[] {
    const rolls = this.frames[frame].rolls;
    const out: string[] = [];
    for (let i = 0; i < rolls.length; i++) {
      const r = rolls[i];
      if (frame < 9) {
        if (i === 0 && r === 10) out.push("X");
        else if (i === 1 && rolls[0] + r === 10) out.push("/");
        else out.push(r === 0 ? "-" : String(r));
      } else {
        // 10. frame: et kast er "andet kast i et sæt", hvis det forrige kast
        // startede et sæt uden at være strike
        const isSecondOfSet =
          (i === 1 && rolls[0] !== 10) ||
          (i === 2 && rolls[0] === 10 && rolls[1] !== 10);
        if (r === 10 && !isSecondOfSet) out.push("X");
        else if (isSecondOfSet && rolls[i - 1] + r === 10) out.push("/");
        else out.push(r === 0 ? "-" : String(r));
      }
    }
    return out;
  }
}
