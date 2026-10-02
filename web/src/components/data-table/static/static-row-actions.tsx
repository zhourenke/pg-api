/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Pencil, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

type StaticRowActionsProps = {
  editLabel: string
  deleteLabel: string
  onEdit: () => void
  onDelete: () => void
  editDisabled?: boolean
  deleteDisabled?: boolean
}

export function StaticRowActions(props: StaticRowActionsProps) {
  return (
    <div className='flex items-center justify-end gap-1'>
      <Button
        variant='ghost'
        size='icon-sm'
        onClick={props.onEdit}
        disabled={props.editDisabled}
        aria-label={props.editLabel}
      >
        <Pencil />
      </Button>
      <Button
        variant='ghost'
        size='icon-sm'
        onClick={props.onDelete}
        disabled={props.deleteDisabled}
        aria-label={props.deleteLabel}
        className='text-destructive hover:text-destructive'
      >
        <Trash2 />
      </Button>
    </div>
  )
}
