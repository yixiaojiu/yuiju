"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@yuiju/shared/ui/components/select";

export type CharacterOption = { id: string; name: string };

/** 单角色部署无需选择；选项只包含公开的角色标识和名称。 */
export function CharacterSelect({
  characters,
  value,
  onChange,
}: {
  characters: CharacterOption[];
  value: string;
  onChange: (characterId: string) => void;
}) {
  if (characters.length <= 1) {
    return null;
  }
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-48" aria-label="角色">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {characters.map((character) => (
          <SelectItem key={character.id} value={character.id}>
            {character.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
