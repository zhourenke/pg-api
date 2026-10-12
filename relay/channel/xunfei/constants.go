package xunfei

var ModelList = []string{
	"SparkDesk",
	"SparkDesk-v1.1",
	"SparkDesk-v2.1",
	"SparkDesk-v3.1",
	"SparkDesk-v3.5",
	"SparkDesk-v4.0",
}

var ChannelName = "xunfei"

// xunfeiTopKMax 是 top_k 的文档上限：文档给的区间是 [1,6]，区间外的值不发上去，厂商因此
// 用它的默认值（4）。
const xunfeiTopKMax = 6
