const crypto = require('crypto')

class FormData {
  constructor() {
    this._boundary = '----FormData' + crypto.randomBytes(8).toString('hex')
    this._parts = []
  }

  append(name, value, filename) {
    this._parts.push({ name, value, filename })
  }

  getBuffer() {
    const boundary = this._boundary
    const chunks = []
    for (const part of this._parts) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"${part.filename ? `; filename="${part.filename}"` : ''}\r\nContent-Type: application/octet-stream\r\n\r\n`))
      chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(String(part.value)))
      chunks.push(Buffer.from('\r\n'))
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`))
    return Buffer.concat(chunks)
  }

  getHeaders() {
    return { 'Content-Type': `multipart/form-data; boundary=${this._boundary}` }
  }
}

module.exports = FormData
