// Tipos da API D4Sign

export interface D4SignSafe {
  uuid_safe: string
  safeName: string
}

export interface D4SignUploadResponse {
  uuid: string
}

export interface D4SignDocument {
  uuidDoc:   string
  nameDoc:   string
  statusDoc: { id: string; name: string }
}

export interface D4SignSignerInput {
  email:                string
  act:                  string  // '1'=assinar '2'=aprovar '5'=testemunha
  foreign:              string  // '0' | '1'
  certificadoicpbr:     string  // '0' | '1'
  assinatura_presencial: string // '0' | '1'
  docauth:              string  // '0' | '1'
  docauthandselfie:     string  // '0' | '1'
  embed_methodauth:     string  // 'email' | 'sms' | 'whatsapp'
  whatsapp_number?:     string
  auth_pix:             string  // '0' | '1'
}

export interface D4SignSignerResponse {
  email:  string
  key_signer: string
}

export interface D4SignSendOptions {
  message?:   string
  skip_email?: string  // '0' | '1'
  workflow?:  string   // '0' | '1'
}

export interface D4SignWebhookPayload {
  uuid:    string
  status:  string
  message: string
}

export interface D4SignDownloadResponse {
  url: string
}
