'use client'

import { Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { Project } from '@/lib/projects'

type DeleteProjectDialogProps = {
  project: Project | null
  onOpenChange: (open: boolean) => void
  onConfirm: (projectId: string) => void
}

export function DeleteProjectDialog({ project, onOpenChange, onConfirm }: DeleteProjectDialogProps) {
  return (
    <AlertDialog open={project !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border border-border bg-card p-6 data-[size=default]:sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-xl font-semibold">Supprimer ce projet ?</AlertDialogTitle>
          <AlertDialogDescription className="text-base">
            Le projet <strong className="text-foreground">{project?.name}</strong> (/{project?.domain}) et
            l&apos;historique de ses audits seront définitivement supprimés.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="-mx-6 -mb-6 border-border bg-transparent p-6">
          <AlertDialogCancel className="h-11 px-5 text-base">Annuler</AlertDialogCancel>
          <button
            type="button"
            onClick={() => project && onConfirm(project.id)}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-destructive px-5 text-base font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive"
          >
            <Trash2 className="size-5" aria-hidden="true" />
            Supprimer
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
