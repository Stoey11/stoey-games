// Køller: carry = maks længde i meter ved fuldt sving, loft = opsendelsesvinkel.
// Starthastigheden beregnes så kastebanen (uden luftmodstand) rammer carry-længden.

export interface Club {
  id: string;
  name: string;
  carry: number;
  loft: number; // grader
  putter?: boolean;
}

export const CLUBS: Club[] = [
  { id: "driver", name: "Driver", carry: 230, loft: 11 },
  { id: "w3", name: "3-kølle", carry: 215, loft: 13 },
  { id: "w5", name: "5-kølle", carry: 200, loft: 16 },
  { id: "i3", name: "3-jern", carry: 185, loft: 18 },
  { id: "i4", name: "4-jern", carry: 172, loft: 20 },
  { id: "i5", name: "5-jern", carry: 160, loft: 23 },
  { id: "i6", name: "6-jern", carry: 150, loft: 26 },
  { id: "i7", name: "7-jern", carry: 140, loft: 30 },
  { id: "i8", name: "8-jern", carry: 130, loft: 34 },
  { id: "i9", name: "9-jern", carry: 118, loft: 38 },
  { id: "pw", name: "Pitching wedge", carry: 105, loft: 44 },
  { id: "gw", name: "Gap wedge", carry: 90, loft: 50 },
  { id: "sw", name: "Sand wedge", carry: 70, loft: 56 },
  { id: "putter", name: "Putter", carry: 40, loft: 0, putter: true },
];

const G = 9.81;

/** Starthastighed (m/s) der giver klubbens carry ved fuld kraft. */
export function launchSpeed(club: Club): number {
  if (club.putter) return 0; // putter håndteres separat
  const rad = (club.loft * Math.PI) / 180;
  return Math.sqrt((club.carry * G) / Math.sin(2 * rad));
}

/** Foreslå kølle ud fra afstand til flaget og underlag. */
export function suggestClub(distance: number, surface: string): Club {
  if (surface === "green") return CLUBS[CLUBS.length - 1];
  if (surface === "bunker") return CLUBS.find((c) => c.id === "sw")!;
  // Mindste kølle der kan nå afstanden (med lidt margen)
  for (let i = CLUBS.length - 2; i >= 0; i--) {
    if (CLUBS[i].carry >= distance * 0.98) {
      // find den korteste der stadig rækker
      let best = i;
      for (let j = CLUBS.length - 2; j >= 0; j--) {
        if (CLUBS[j].carry >= distance * 0.98 && CLUBS[j].carry < CLUBS[best].carry) best = j;
      }
      return CLUBS[best];
    }
  }
  return CLUBS[0]; // driver
}
