export interface DocumentTopic {
  id: string
  level: number
  text: string
  pos: number
}

export interface AiRewriteResult {
  original: string
  rewritten: string
  topicId: string
  topicText: string
}
