import { defineParams } from "@cadit-app/script-params";
import { PIECE_IDS, makeAllPieces, makePiece, type PieceId } from "./chess";

export default defineParams({
  params: {
    piece: {
      type: "choice",
      label: "Piece",
      default: "all",
      options: [
        { value: "all", label: "All pieces" },
        ...PIECE_IDS.map((id) => ({ value: id, label: id })),
      ],
    },
  },
  main: async (p) => {
    const piece = (p as any)?.piece as string | undefined;
    if (!piece || piece === "all") return makeAllPieces();
    return makePiece(piece as PieceId);
  },
});

