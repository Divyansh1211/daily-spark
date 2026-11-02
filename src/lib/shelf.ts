import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import type { KindId, ShelfItem, Status } from "./shelf-kinds";

type Row = {
  id: string;
  title: string;
  kind: KindId;
  status: Status;
  link: string | null;
  note: string;
  owner: string | null;
  owner_name: string | null;
  added_by: string | null;
  adder_name: string | null;
  updated_at: number;
};

const SELECT = `SELECT s.id, s.title, s.kind, s.status, s.link, s.note, s.owner, o.name AS owner_name,
  s.added_by, a.name AS adder_name, s.updated_at
  FROM shelf_items s LEFT JOIN users o ON o.id = s.owner LEFT JOIN users a ON a.id = s.added_by`;

function toItem(r: Row): ShelfItem {
  const suggested = r.owner !== null && r.added_by !== null && r.added_by !== r.owner;
  return {
    id: r.id,
    title: r.title,
    kind: r.kind,
    status: r.status,
    link: r.link,
    note: r.note,
    forId: r.owner,
    forName: r.owner_name,
    fromName: suggested ? r.adder_name : null,
    updatedAt: r.updated_at,
  };
}

/** Everything on the shelf, both people's, most recently changed first. */
export function listShelf(): ShelfItem[] {
  return (db().prepare(`${SELECT} ORDER BY s.updated_at DESC`).all() as Row[]).map(toItem);
}

export function getShelfItem(id: string) {
  const row = db().prepare(`${SELECT} WHERE s.id = ?`).get(id) as Row | undefined;
  return row ? { item: toItem(row), owner: row.owner, addedBy: row.added_by } : null;
}

export function addShelfItem(
  addedBy: string,
  e: { title: string; kind: KindId; status: Status; owner: string | null; link: string | null; note: string },
) {
  const id = randomUUID();
  const now = Date.now();
  db().prepare(
    `INSERT INTO shelf_items (id, title, kind, status, owner, added_by, link, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, e.title, e.kind, e.status, e.owner, addedBy, e.link, e.note, now, now);
  return id;
}

export function setShelfStatus(id: string, status: Status) {
  db().prepare("UPDATE shelf_items SET status = ?, updated_at = ? WHERE id = ?").run(status, Date.now(), id);
}

export function deleteShelfItem(id: string) {
  db().prepare("DELETE FROM shelf_items WHERE id = ?").run(id);
}
