// 工具函数：二维码识别、证书格式化、下载、截图等
// 这里只做导出，具体实现见renderer.js

// 证书信息格式化
function formatCertificate(cert) {
  if (!cert) return '没有证书信息';
  return `颁发者：${cert.issuerName}\n有效期：${cert.validStart} ~ ${cert.validExpiry}`;
}

module.exports = { formatCertificate };
