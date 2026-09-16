export type EditPlan
  = | {
    kind: 'write'
    path: string
    contents: string
    streamContent: string
  }
  | {
    kind: 'stringReplace'
    path: string
    oldString: string
    newString: string
    replaceAll: boolean
    streamContent: string
  }
  | {
    kind: 'applyPatch'
    path: string
    patchText: string
    parsedPatch: unknown
    streamContent: string
  }
  | {
    kind: 'editNotebook'
    path: string
    cellIdx: number
    isNewCell: boolean
    cellLanguage: string
    oldString: string
    newString: string
    streamContent: string
  }
