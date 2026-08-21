import { describe, expect, it } from "vitest";

import { toDativeName } from "./turkish";

describe("toDativeName", () => {
  it("ünsüzle biten ince isimlere 'e' ekler", () => {
    expect(toDativeName("Sen")).toBe("Sen'e");
    expect(toDativeName("Mehmet")).toBe("Mehmet'e");
    expect(toDativeName("Zeynep")).toBe("Zeynep'e");
  });

  it("ünsüzle biten kalın isimlere 'a' ekler", () => {
    expect(toDativeName("Burak")).toBe("Burak'a");
    expect(toDativeName("Oğuz")).toBe("Oğuz'a");
    expect(toDativeName("Yalın")).toBe("Yalın'a");
  });

  it("ünlüyle biten isimlerde kaynaştırma harfi kullanır", () => {
    expect(toDativeName("Ayşe")).toBe("Ayşe'ye");
    expect(toDativeName("Ali")).toBe("Ali'ye");
    expect(toDativeName("Ata")).toBe("Ata'ya");
    expect(toDativeName("Suzi")).toBe("Suzi'ye");
  });

  it("baş ve sondaki boşlukları temizler", () => {
    expect(toDativeName("  Ayşe  ")).toBe("Ayşe'ye");
  });

  it("boş ismi olduğu gibi bırakır", () => {
    expect(toDativeName("")).toBe("");
    expect(toDativeName("   ")).toBe("");
  });

  it("ünlü içermeyen isimde ince eki varsayar", () => {
    expect(toDativeName("Ş")).toBe("Ş'e");
  });
});
