import { describe, expect, it } from "vitest";
import { DEPARTMENT_NEIGHBORS, departmentFromPostalCode, departmentFromText, departmentName, neighborDepartments } from "./geo";

describe("géographie", () => {
  it.each([
    ["Villeurbanne, Auvergne-Rhône-Alpes, France", "69"],
    ["Paris 9e Arrondissement", "75"],
    ["75009 Paris", "75"],
    ["Lyon (69)", "69"],
    ["Rhône", "69"],
    ["Val-d'Oise", "95"],
    ["La Défense", "92"],
    ["Issy-les-Moulineaux, France", "92"],
    ["Lyon", "69"],
    ["Berlin, Germany", "99"],
    ["London, UK", "99"],
    ["Remote", null],
    ["France", null],
    ["", null],
  ] as const)("%s → %s", (text, expected) => {
    expect(departmentFromText(text)).toBe(expected);
  });

  it("codes postaux", () => {
    expect(departmentFromPostalCode("69100")).toBe("69");
    expect(departmentFromPostalCode("97400")).toBe("974");
    expect(departmentFromPostalCode("20000")).toBe("2A");
    expect(departmentFromPostalCode("6020")).toBeNull();
  });

  it("nom d'un département", () => {
    expect(departmentName("69")).toBe("Rhône");
    expect(departmentName("00")).toBeNull();
  });
});

describe("départements voisins", () => {
  it("la relation est symétrique et couvre toute la métropole", () => {
    expect(Object.keys(DEPARTMENT_NEIGHBORS)).toHaveLength(96);
    for (const [a, list] of Object.entries(DEPARTMENT_NEIGHBORS)) {
      for (const b of list) expect(DEPARTMENT_NEIGHBORS[b], `${a} ↔ ${b}`).toContain(a);
    }
  });
  it("exemples", () => {
    expect(neighborDepartments("69")).toEqual(["01", "38", "42", "71"]);
    expect(neighborDepartments("75")).toContain("92");
    expect(neighborDepartments("971")).toEqual([]);
  });
});
