import { supabase } from "@/lib/supabase"

export type TeamRoom = { id: string; name: string; owner_id: string; member_count: number; role: "owner" | "member"; invite_code?: string }
export type TeamRoomFile = { id: string; room_id: string; name: string; yaml_content: string; updated_at: string; updated_by: string }

function client() {
  if (!supabase) throw new Error("Supabase is not configured.")
  return supabase
}

export async function listTeamRooms(): Promise<TeamRoom[]> {
  const { data, error } = await client().rpc("list_team_rooms")
  if (error) throw error
  return (data ?? []) as TeamRoom[]
}

export async function createTeamRoom(name: string): Promise<TeamRoom> {
  const { data, error } = await client().rpc("create_team_room", { room_name: name.trim() })
  if (error) throw error
  return data as TeamRoom
}

export async function joinTeamRoom(code: string): Promise<TeamRoom> {
  const { data, error } = await client().rpc("join_team_room", { invite_code: code.replace(/\D/g, "") })
  if (error) throw error
  return data as TeamRoom
}

export async function listTeamRoomFiles(roomId: string): Promise<TeamRoomFile[]> {
  const { data, error } = await client().from("team_room_files").select("id, room_id, name, yaml_content, updated_at, updated_by").eq("room_id", roomId).order("updated_at", { ascending: false })
  if (error) throw error
  return (data ?? []) as TeamRoomFile[]
}

export async function saveTeamRoomFile(roomId: string, name: string, yaml: string) {
  const { data, error } = await client().from("team_room_files").upsert(
    { room_id: roomId, name: name.trim(), yaml_content: yaml, updated_by: (await client().auth.getUser()).data.user?.id, updated_at: new Date().toISOString() },
    { onConflict: "room_id,name" },
  ).select("id, room_id, name, yaml_content, updated_at, updated_by").single()
  if (error) throw error
  return data as TeamRoomFile
}
